import json
import time
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.ai import (
    OpenRouterError,
    derive_conversation_title,
    generation_registry,
    resolve_model_name,
    stream_openrouter_chat,
    test_openrouter_connection,
)
from app.auth import AuthenticatedUser, get_current_user
from app.config import Settings, get_settings
from app.database import (
    create_conversation,
    delete_message,
    get_conversation,
    get_user_settings,
    insert_message,
    list_messages,
    log_error,
    log_usage,
    update_conversation_title,
)
from app.rate_limit import SlidingWindowRateLimiter

router = APIRouter(prefix="/api/chat", tags=["chat"])

_rate_limiter_instance: Optional[SlidingWindowRateLimiter] = None


def get_rate_limiter(settings: Settings = Depends(get_settings)) -> SlidingWindowRateLimiter:
    global _rate_limiter_instance
    if _rate_limiter_instance is None:
        _rate_limiter_instance = SlidingWindowRateLimiter(
            max_requests=settings.rate_limit_requests_per_minute,
            window_seconds=60,
        )
    return _rate_limiter_instance


class ChatStreamRequest(BaseModel):
    conversation_id: Optional[UUID] = None
    message: Optional[str] = Field(default=None)
    retry: bool = False
    assistant_message_id: Optional[UUID] = None


class ChatStopRequest(BaseModel):
    conversation_id: UUID


def _sse_event(event_name: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload)}\n\n"


@router.post("/test")
async def test_ai_connection(
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    rate_limiter: SlidingWindowRateLimiter = Depends(get_rate_limiter),
):
    """Execute a real minimal OpenRouter model request to verify live connectivity."""
    await rate_limiter.check(current_user.id)
    result = await test_openrouter_connection(settings)
    return result


@router.post("/stream")
async def stream_chat(
    request: Request,
    body: ChatStreamRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    rate_limiter: SlidingWindowRateLimiter = Depends(get_rate_limiter),
):
    await rate_limiter.check(current_user.id)

    if not body.retry:
        raw_message = (body.message or "").strip()
        if not raw_message:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Message content cannot be empty.",
            )
        if len(raw_message) > settings.max_message_length:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Message exceeds maximum allowed length of {settings.max_message_length} characters.",
            )
    else:
        raw_message = ""
        if not body.conversation_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="conversation_id is required when retrying a response.",
            )

    if body.conversation_id:
        conv_id = str(body.conversation_id)
        conversation = await get_conversation(
            conversation_id=conv_id,
            user_id=current_user.id,
            access_token=current_user.access_token,
            settings=settings,
        )
    else:
        derived_title = derive_conversation_title(raw_message)
        conversation = await create_conversation(
            user_id=current_user.id,
            title=derived_title,
            access_token=current_user.access_token,
            settings=settings,
        )
        conv_id = conversation["id"]

    existing_messages = await list_messages(
        conversation_id=conv_id,
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
        limit=100,
    )

    saved_user_message: Optional[Dict[str, Any]] = None

    if body.retry:
        if body.assistant_message_id:
            target_id = str(body.assistant_message_id)
            if any(m["id"] == target_id and m["role"] == "assistant" for m in existing_messages):
                await delete_message(
                    message_id=target_id,
                    conversation_id=conv_id,
                    user_id=current_user.id,
                    access_token=current_user.access_token,
                    settings=settings,
                )
                existing_messages = [m for m in existing_messages if m["id"] != target_id]
        if not existing_messages or existing_messages[-1]["role"] != "user":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No preceding user message found to retry.",
            )
    else:
        if len(existing_messages) == 0 and conversation.get("title") == "New Conversation":
            new_title = derive_conversation_title(raw_message)
            updated = await update_conversation_title(
                conversation_id=conv_id,
                user_id=current_user.id,
                title=new_title,
                access_token=current_user.access_token,
                settings=settings,
            )
            if updated:
                conversation = updated

        saved_user_message = await insert_message(
            conversation_id=conv_id,
            user_id=current_user.id,
            role="user",
            content=raw_message,
            access_token=current_user.access_token,
            settings=settings,
        )
        existing_messages.append(saved_user_message)

    recent_context: List[Dict[str, str]] = [
        {"role": m["role"], "content": m["content"]}
        for m in existing_messages[-settings.max_context_messages :]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]

    user_settings = await get_user_settings(
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
    )
    model_name = resolve_model_name(user_settings.get("preferred_model"), settings)
    stop_event = await generation_registry.register(current_user.id, conv_id)

    async def event_generator():
        started_at = time.monotonic()
        chunks: List[str] = []
        status_str = "completed"

        try:
            yield _sse_event(
                "meta",
                {
                    "conversation": conversation,
                    "user_message": saved_user_message,
                    "model": model_name,
                },
            )

            async for token in stream_openrouter_chat(
                messages=recent_context,
                settings=settings,
                stop_event=stop_event,
                model_name=model_name,
            ):
                if await request.is_disconnected():
                    stop_event.set()
                    status_str = "stopped"
                    break
                chunks.append(token)
                yield _sse_event("token", {"token": token})
                if stop_event.is_set():
                    status_str = "stopped"
                    break

            if stop_event.is_set():
                status_str = "stopped"

            full_text = "".join(chunks)
            saved_assistant_message = None
            if full_text.strip():
                saved_assistant_message = await insert_message(
                    conversation_id=conv_id,
                    user_id=current_user.id,
                    role="assistant",
                    content=full_text,
                    access_token=current_user.access_token,
                    settings=settings,
                )

            latency_ms = int((time.monotonic() - started_at) * 1000)
            prompt_chars = sum(len(m["content"]) for m in recent_context)
            await log_usage(
                user_id=current_user.id,
                conversation_id=conv_id,
                model=model_name or "unconfigured",
                prompt_chars=prompt_chars,
                completion_chars=len(full_text),
                latency_ms=latency_ms,
                status_str=status_str,
                access_token=current_user.access_token,
                settings=settings,
            )

            yield _sse_event(
                "done",
                {
                    "assistant_message": saved_assistant_message,
                    "stopped": status_str == "stopped",
                },
            )

        except OpenRouterError as exc:
            status_str = "error"
            await log_error(
                user_id=current_user.id,
                endpoint="/api/chat/stream",
                error_type=exc.code,
                message=exc.message,
                settings=settings,
            )
            yield _sse_event(
                "error",
                {
                    "error": exc.message,
                    "code": exc.code,
                },
            )
        except Exception as exc:
            status_str = "error"
            await log_error(
                user_id=current_user.id,
                endpoint="/api/chat/stream",
                error_type=type(exc).__name__,
                message="Unexpected error during OpenRouter response streaming.",
                settings=settings,
            )
            yield _sse_event(
                "error",
                {
                    "error": "An unexpected error occurred while generating the response.",
                    "code": "INTERNAL_ERROR",
                },
            )
        finally:
            await generation_registry.clear(current_user.id, conv_id, stop_event)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/stop")
async def stop_chat(
    body: ChatStopRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    conv_id = str(body.conversation_id)
    await get_conversation(
        conversation_id=conv_id,
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
    )
    stopped = await generation_registry.stop(current_user.id, conv_id)
    return {"stopped": stopped, "conversation_id": conv_id}
