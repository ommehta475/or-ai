from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import AuthenticatedUser, get_current_user
from app.config import Settings, get_settings
from app.database import (
    create_abuse_report,
    get_user_settings,
    update_profile_by_id,
    update_user_settings,
)

router = APIRouter(prefix="/api", tags=["users"])


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=120)
    theme: Optional[str] = Field(default=None, pattern="^(dark|light)$")
    preferred_model: Optional[str] = Field(default=None, max_length=100)


class AbuseReportRequest(BaseModel):
    conversation_id: Optional[str] = None
    message_id: Optional[str] = None
    reason: str = Field(min_length=3, max_length=120)
    details: str = Field(default="", max_length=1000)


@router.get("/me")
async def get_me(
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    user_settings = await get_user_settings(
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
    )
    return {
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "full_name": current_user.profile.get("full_name", ""),
            "avatar_url": current_user.profile.get("avatar_url"),
            "role": current_user.role,
            "status": current_user.status,
            "message_count": current_user.profile.get("message_count", 0),
        },
        "settings": user_settings,
        "limits": {
            "max_message_length": settings.max_message_length,
            "max_output_tokens": settings.max_output_tokens,
            "default_model": settings.openrouter_model.strip(),
        },
    }


@router.patch("/me")
async def patch_me(
    body: UpdateProfileRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    updated_profile = await update_profile_by_id(
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
        full_name=body.full_name,
    )
    updated_settings = await update_user_settings(
        user_id=current_user.id,
        access_token=current_user.access_token,
        settings=settings,
        theme=body.theme,
        preferred_model=body.preferred_model,
    )
    return {
        "user": updated_profile,
        "settings": updated_settings,
    }


@router.post("/reports", status_code=status.HTTP_201_CREATED)
async def submit_abuse_report(
    body: AbuseReportRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    if not body.reason.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reason is required.")
    report = await create_abuse_report(
        reporter_id=current_user.id,
        conversation_id=body.conversation_id,
        message_id=body.message_id,
        reason=body.reason,
        details=body.details,
        access_token=current_user.access_token,
        settings=settings,
    )
    return {"report": report}
