import asyncio
import json
import time
from typing import Any, AsyncGenerator, Dict, List, Optional

import httpx

from app.config import Settings

SYSTEM_PROMPT = (
    "You are ORLIXA AI, a precise, helpful, and thoughtful AI assistant built by Orlixa Labs. "
    "Provide clear, accurate answers. Format code blocks with appropriate language identifiers."
)


class OpenRouterError(Exception):
    """Structured error raised when OpenRouter API fails or is misconfigured."""

    def __init__(self, message: str, code: str = "OPENROUTER_ERROR", status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


class ActiveGenerationRegistry:
    """Tracks active SSE generation tasks so users can cancel via /api/chat/stop."""

    def __init__(self) -> None:
        self._events: Dict[str, asyncio.Event] = {}
        self._lock = asyncio.Lock()

    def _key(self, user_id: str, conversation_id: str) -> str:
        return f"{user_id}:{conversation_id}"

    async def register(self, user_id: str, conversation_id: str) -> asyncio.Event:
        key = self._key(user_id, conversation_id)
        async with self._lock:
            existing = self._events.get(key)
            if existing:
                existing.set()
            event = asyncio.Event()
            self._events[key] = event
            return event

    async def stop(self, user_id: str, conversation_id: str) -> bool:
        key = self._key(user_id, conversation_id)
        async with self._lock:
            event = self._events.get(key)
            if event:
                event.set()
                return True
            return False

    async def clear(self, user_id: str, conversation_id: str, event: asyncio.Event) -> None:
        key = self._key(user_id, conversation_id)
        async with self._lock:
            if self._events.get(key) is event:
                self._events.pop(key, None)


generation_registry = ActiveGenerationRegistry()


def resolve_model_name(preferred_model: Optional[str], settings: Settings) -> str:
    candidate = (preferred_model or "").strip()
    # Treat blank or legacy pre-migration local value as inheriting server OPENROUTER_MODEL
    if not candidate or candidate == "Qwen3-4B":
        return settings.openrouter_model.strip()
    return candidate


def derive_conversation_title(first_message: str) -> str:
    cleaned = " ".join(first_message.strip().split())
    if not cleaned:
        return "New Conversation"
    if len(cleaned) <= 52:
        return cleaned
    return cleaned[:49].rstrip() + "..."


def _openrouter_headers(settings: Settings) -> Dict[str, str]:
    headers: Dict[str, str] = {
        "Authorization": f"Bearer {settings.openrouter_api_key.strip()}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_site_url.strip():
        headers["HTTP-Referer"] = settings.openrouter_site_url.strip()
    if settings.openrouter_app_name.strip():
        headers["X-Title"] = settings.openrouter_app_name.strip()
    return headers


def _map_openrouter_http_error(status_code: int, raw_body: bytes, model_name: str) -> OpenRouterError:
    upstream_msg = ""
    try:
        parsed = json.loads(raw_body.decode("utf-8", errors="ignore"))
        err_obj = parsed.get("error") if isinstance(parsed, dict) else None
        if isinstance(err_obj, dict) and isinstance(err_obj.get("message"), str):
            upstream_msg = err_obj["message"].strip()[:240]
    except Exception:
        pass

    if status_code in (401, 403):
        return OpenRouterError(
            "OpenRouter authentication failed. Verify OPENROUTER_API_KEY on the backend.",
            code="OPENROUTER_AUTH_ERROR",
            status_code=status_code,
        )
    if status_code == 402:
        return OpenRouterError(
            "Insufficient OpenRouter credits. Please add credits to your OpenRouter account.",
            code="INSUFFICIENT_CREDITS",
            status_code=402,
        )
    if status_code == 404 or (status_code == 400 and "model" in upstream_msg.lower()):
        return OpenRouterError(
            "Configured OpenRouter model is invalid or unavailable. Check OPENROUTER_MODEL on the backend.",
            code="INVALID_MODEL",
            status_code=status_code,
        )
    if status_code == 429:
        return OpenRouterError(
            "OpenRouter rate limit exceeded. Please wait a moment and try again.",
            code="RATE_LIMITED",
            status_code=429,
        )
    if status_code >= 500:
        return OpenRouterError(
            "OpenRouter upstream service is temporarily unavailable.",
            code="UPSTREAM_UNAVAILABLE",
            status_code=status_code,
        )
    detail = f": {upstream_msg}" if upstream_msg else ""
    return OpenRouterError(
        f"OpenRouter rejected the request (HTTP {status_code}){detail}",
        code="OPENROUTER_REQUEST_ERROR",
        status_code=status_code,
    )


async def stream_openrouter_chat(
    messages: List[Dict[str, str]],
    settings: Settings,
    stop_event: asyncio.Event,
    model_name: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    if not settings.openrouter_api_key_present:
        raise OpenRouterError(
            "OPENROUTER_API_KEY is not configured on the backend.",
            code="OPENROUTER_NOT_CONFIGURED",
            status_code=503,
        )

    resolved_model = resolve_model_name(model_name, settings)
    if not resolved_model:
        raise OpenRouterError(
            "OPENROUTER_MODEL is not configured on the backend.",
            code="MODEL_NOT_CONFIGURED",
            status_code=503,
        )

    if not settings.openrouter_base_url_valid:
        raise OpenRouterError(
            "OPENROUTER_BASE_URL must be a valid HTTPS URL.",
            code="OPENROUTER_CONFIG_ERROR",
            status_code=500,
        )

    endpoint = f"{settings.openrouter_base_url.strip().rstrip('/')}/chat/completions"
    payload = {
        "model": resolved_model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
        "stream": True,
        "max_tokens": settings.max_output_tokens,
        "temperature": settings.ai_temperature,
    }

    timeout = httpx.Timeout(
        connect=10.0,
        read=float(settings.ai_request_timeout_seconds),
        write=15.0,
        pool=10.0,
    )

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                endpoint,
                headers=_openrouter_headers(settings),
                json=payload,
            ) as resp:
                if resp.status_code >= 400:
                    body = await resp.aread()
                    raise _map_openrouter_http_error(resp.status_code, body, resolved_model)

                async for line in resp.aiter_lines():
                    if stop_event.is_set():
                        break
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    if isinstance(chunk, dict) and chunk.get("error"):
                        err = chunk["error"]
                        msg = err.get("message", "OpenRouter streaming error.") if isinstance(err, dict) else "OpenRouter streaming error."
                        raise OpenRouterError(msg[:240], code="OPENROUTER_STREAM_ERROR", status_code=502)

                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    token = delta.get("content")
                    if token:
                        yield token
    except OpenRouterError:
        raise
    except (httpx.ConnectTimeout, httpx.ReadTimeout) as exc:
        raise OpenRouterError(
            "OpenRouter request timed out before completion.",
            code="TIMEOUT",
            status_code=504,
        ) from exc
    except httpx.HTTPError as exc:
        raise OpenRouterError(
            "Unable to reach OpenRouter API. Check network connectivity.",
            code="OPENROUTER_UNREACHABLE",
            status_code=503,
        ) from exc


async def test_openrouter_connection(settings: Settings) -> Dict[str, Any]:
    """Perform a real, minimal OpenRouter completion request to verify live connectivity."""
    if not settings.openrouter_api_key_present:
        return {
            "connected": False,
            "model": settings.openrouter_model.strip(),
            "latency_ms": 0,
            "detail": "OPENROUTER_API_KEY is missing.",
        }
    if not settings.openrouter_model_configured:
        return {
            "connected": False,
            "model": "",
            "latency_ms": 0,
            "detail": "OPENROUTER_MODEL is missing.",
        }
    if not settings.openrouter_base_url_valid:
        return {
            "connected": False,
            "model": settings.openrouter_model.strip(),
            "latency_ms": 0,
            "detail": "OPENROUTER_BASE_URL is invalid.",
        }

    endpoint = f"{settings.openrouter_base_url.strip().rstrip('/')}/chat/completions"
    model = settings.openrouter_model.strip()
    started = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                endpoint,
                headers=_openrouter_headers(settings),
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Reply with OK."}],
                    "max_tokens": 1,
                    "temperature": 0,
                    "stream": False,
                },
            )
        latency_ms = int((time.monotonic() - started) * 1000)

        if resp.status_code >= 400:
            mapped = _map_openrouter_http_error(resp.status_code, resp.content, model)
            return {
                "connected": False,
                "model": model,
                "latency_ms": latency_ms,
                "status_code": resp.status_code,
                "code": mapped.code,
                "detail": mapped.message,
            }

        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            return {
                "connected": False,
                "model": model,
                "latency_ms": latency_ms,
                "detail": "OpenRouter returned an empty completion response.",
            }

        return {
            "connected": True,
            "model": data.get("model") or model,
            "latency_ms": latency_ms,
            "detail": "OpenRouter live model request succeeded.",
        }
    except httpx.TimeoutException:
        return {
            "connected": False,
            "model": model,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "code": "TIMEOUT",
            "detail": "OpenRouter connection test timed out.",
        }
    except httpx.HTTPError:
        return {
            "connected": False,
            "model": model,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "code": "OPENROUTER_UNREACHABLE",
            "detail": "Unable to reach OpenRouter API.",
        }
