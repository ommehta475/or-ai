from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx
from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings
from app.database import get_profile_by_id


@dataclass
class AuthenticatedUser:
    id: str
    email: str
    access_token: str
    role: str
    status: str
    profile: Dict[str, Any]


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Expected Bearer token.",
        )
    return parts[1].strip()


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedUser:
    if not settings.supabase_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase authentication is not configured on the backend.",
        )

    token = _extract_bearer_token(authorization)
    user_endpoint = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                user_endpoint,
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {token}",
                },
            )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to reach authentication service.",
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token.",
        )

    auth_payload = resp.json()
    user_id = auth_payload.get("id")
    email = auth_payload.get("email", "")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed authentication response.",
        )

    profile = await get_profile_by_id(user_id=user_id, access_token=token, settings=settings)
    if not profile:
        profile = {
            "id": user_id,
            "email": email,
            "full_name": auth_payload.get("user_metadata", {}).get("full_name", ""),
            "role": "user",
            "status": "active",
            "message_count": 0,
        }

    if profile.get("status") == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been suspended. Please contact Orlixa Labs support.",
        )

    return AuthenticatedUser(
        id=user_id,
        email=email,
        access_token=token,
        role=profile.get("role", "user"),
        status=profile.get("status", "active"),
        profile=profile,
    )


async def require_admin(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )
    return current_user
