from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException, status

from app.config import Settings

try:
    from supabase import Client as SupabaseClient
    from supabase import create_client as create_supabase_client
except ImportError:
    SupabaseClient = Any  # type: ignore[misc,assignment]
    create_supabase_client = None


def init_supabase_client(settings: Settings) -> Optional[SupabaseClient]:
    """Initialize and return the Supabase Python client if configured and valid."""
    if not settings.supabase_configured or create_supabase_client is None:
        return None
    try:
        return create_supabase_client(
            settings.supabase_url.strip().rstrip("/"),
            settings.supabase_anon_key.strip(),
        )
    except Exception:
        return None


def _rest_headers(access_token: str, settings: Settings, prefer: str = "return=representation") -> Dict[str, str]:
    return {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _service_headers(settings: Settings, prefer: str = "return=representation") -> Optional[Dict[str, str]]:
    if not settings.supabase_service_role_key.strip():
        return None
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


async def _request(
    method: str,
    url: str,
    headers: Dict[str, str],
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Any] = None,
) -> Any:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json_body,
            )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database service is currently unavailable.",
        )

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY if resp.status_code >= 500 else resp.status_code,
            detail="Database operation could not be completed.",
        )

    if not resp.text:
        return None
    return resp.json()


async def get_profile_by_id(user_id: str, access_token: str, settings: Settings) -> Optional[Dict[str, Any]]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/profiles"
    rows = await _request(
        "GET",
        url,
        headers=_rest_headers(access_token, settings),
        params={"id": f"eq.{user_id}", "select": "*"},
    )
    return rows[0] if rows else None


async def update_profile_by_id(
    user_id: str,
    access_token: str,
    settings: Settings,
    full_name: Optional[str] = None,
    avatar_url: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    if full_name is not None:
        payload["full_name"] = full_name.strip()[:120]
    if avatar_url is not None:
        payload["avatar_url"] = avatar_url.strip()[:500]
    if not payload:
        existing = await get_profile_by_id(user_id, access_token, settings)
        return existing or {}

    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/profiles"
    rows = await _request(
        "PATCH",
        url,
        headers=_rest_headers(access_token, settings),
        params={"id": f"eq.{user_id}"},
        json_body=payload,
    )
    return rows[0] if rows else {}


async def get_user_settings(user_id: str, access_token: str, settings: Settings) -> Dict[str, Any]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/user_settings"
    rows = await _request(
        "GET",
        url,
        headers=_rest_headers(access_token, settings),
        params={"user_id": f"eq.{user_id}", "select": "*"},
    )
    if rows:
        return rows[0]

    created = await _request(
        "POST",
        url,
        headers=_rest_headers(access_token, settings),
        json_body={
            "user_id": user_id,
            "theme": "dark",
            "preferred_model": settings.openrouter_model.strip(),
        },
    )
    return created[0] if created else {"theme": "dark", "preferred_model": settings.openrouter_model.strip()}


async def update_user_settings(
    user_id: str,
    access_token: str,
    settings: Settings,
    theme: Optional[str] = None,
    preferred_model: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    if theme in ("dark", "light"):
        payload["theme"] = theme
    if preferred_model is not None and preferred_model.strip():
        payload["preferred_model"] = preferred_model.strip()[:100]

    if not payload:
        return await get_user_settings(user_id, access_token, settings)

    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/user_settings"
    rows = await _request(
        "PATCH",
        url,
        headers=_rest_headers(access_token, settings),
        params={"user_id": f"eq.{user_id}"},
        json_body=payload,
    )
    return rows[0] if rows else await get_user_settings(user_id, access_token, settings)


async def list_conversations(user_id: str, access_token: str, settings: Settings) -> List[Dict[str, Any]]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/conversations"
    rows = await _request(
        "GET",
        url,
        headers=_rest_headers(access_token, settings),
        params={
            "user_id": f"eq.{user_id}",
            "select": "id,user_id,title,created_at,updated_at",
            "order": "updated_at.desc",
            "limit": "100",
        },
    )
    return rows or []


async def create_conversation(
    user_id: str,
    title: str,
    access_token: str,
    settings: Settings,
) -> Dict[str, Any]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/conversations"
    rows = await _request(
        "POST",
        url,
        headers=_rest_headers(access_token, settings),
        json_body={"user_id": user_id, "title": title.strip()[:120] or "New Conversation"},
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create conversation.")
    return rows[0]


async def get_conversation(
    conversation_id: str,
    user_id: str,
    access_token: str,
    settings: Settings,
) -> Dict[str, Any]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/conversations"
    rows = await _request(
        "GET",
        url,
        headers=_rest_headers(access_token, settings),
        params={
            "id": f"eq.{conversation_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,user_id,title,created_at,updated_at",
        },
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    return rows[0]


async def update_conversation_title(
    conversation_id: str,
    user_id: str,
    title: str,
    access_token: str,
    settings: Settings,
) -> Dict[str, Any]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/conversations"
    rows = await _request(
        "PATCH",
        url,
        headers=_rest_headers(access_token, settings),
        params={"id": f"eq.{conversation_id}", "user_id": f"eq.{user_id}"},
        json_body={"title": title.strip()[:120] or "New Conversation"},
    )
    return rows[0] if rows else {}


async def delete_conversation(
    conversation_id: str,
    user_id: str,
    access_token: str,
    settings: Settings,
) -> None:
    await get_conversation(conversation_id, user_id, access_token, settings)
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/conversations"
    await _request(
        "DELETE",
        url,
        headers=_rest_headers(access_token, settings, prefer="return=minimal"),
        params={"id": f"eq.{conversation_id}", "user_id": f"eq.{user_id}"},
    )


async def list_messages(
    conversation_id: str,
    user_id: str,
    access_token: str,
    settings: Settings,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/messages"
    rows = await _request(
        "GET",
        url,
        headers=_rest_headers(access_token, settings),
        params={
            "conversation_id": f"eq.{conversation_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,conversation_id,user_id,role,content,token_count,created_at",
            "order": "created_at.asc",
            "limit": str(limit),
        },
    )
    return rows or []


async def insert_message(
    conversation_id: str,
    user_id: str,
    role: str,
    content: str,
    access_token: str,
    settings: Settings,
    token_count: int = 0,
) -> Dict[str, Any]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/messages"
    rows = await _request(
        "POST",
        url,
        headers=_rest_headers(access_token, settings),
        json_body={
            "conversation_id": conversation_id,
            "user_id": user_id,
            "role": role,
            "content": content,
            "token_count": token_count,
        },
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save message.")
    return rows[0]


async def delete_message(
    message_id: str,
    conversation_id: str,
    user_id: str,
    access_token: str,
    settings: Settings,
) -> None:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/messages"
    await _request(
        "DELETE",
        url,
        headers=_rest_headers(access_token, settings, prefer="return=minimal"),
        params={
            "id": f"eq.{message_id}",
            "conversation_id": f"eq.{conversation_id}",
            "user_id": f"eq.{user_id}",
        },
    )


async def log_usage(
    user_id: str,
    conversation_id: str,
    model: str,
    prompt_chars: int,
    completion_chars: int,
    latency_ms: int,
    status_str: str,
    access_token: str,
    settings: Settings,
) -> None:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/usage_logs"
    try:
        await _request(
            "POST",
            url,
            headers=_rest_headers(access_token, settings, prefer="return=minimal"),
            json_body={
                "user_id": user_id,
                "conversation_id": conversation_id,
                "model": model,
                "prompt_chars": prompt_chars,
                "completion_chars": completion_chars,
                "latency_ms": latency_ms,
                "status": status_str,
            },
        )
    except Exception:
        pass


async def log_error(
    user_id: Optional[str],
    endpoint: str,
    error_type: str,
    message: str,
    settings: Settings,
) -> None:
    headers = _service_headers(settings, prefer="return=minimal")
    if not headers:
        return
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/error_logs"
    try:
        await _request(
            "POST",
            url,
            headers=headers,
            json_body={
                "user_id": user_id,
                "endpoint": endpoint[:120],
                "error_type": error_type[:80],
                "message": message[:500],
            },
        )
    except Exception:
        pass


async def create_abuse_report(
    reporter_id: str,
    conversation_id: Optional[str],
    message_id: Optional[str],
    reason: str,
    details: str,
    access_token: str,
    settings: Settings,
) -> Dict[str, Any]:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/abuse_reports"
    rows = await _request(
        "POST",
        url,
        headers=_rest_headers(access_token, settings),
        json_body={
            "reporter_id": reporter_id,
            "conversation_id": conversation_id,
            "message_id": message_id,
            "reason": reason.strip()[:120],
            "details": details.strip()[:1000],
        },
    )
    return rows[0] if rows else {}
