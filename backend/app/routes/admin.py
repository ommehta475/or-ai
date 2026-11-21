from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import AuthenticatedUser, require_admin
from app.config import Settings, get_settings
from app.database import _request, _service_headers

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UpdateUserStatusRequest(BaseModel):
    status: str = Field(pattern="^(active|suspended)$")


class UpdateReportStatusRequest(BaseModel):
    status: str = Field(pattern="^(open|reviewed|dismissed)$")


@router.get("/overview")
async def get_admin_overview(
    _admin: AuthenticatedUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    headers = _service_headers(settings)
    if not headers:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SUPABASE_SERVICE_ROLE_KEY is required on the server for admin overview queries.",
        )

    base = settings.supabase_url.rstrip("/")
    users = await _request(
        "GET",
        f"{base}/rest/v1/profiles",
        headers=headers,
        params={"select": "id,email,full_name,role,status,message_count,last_active_at,created_at", "order": "created_at.desc", "limit": "50"},
    )
    error_logs = await _request(
        "GET",
        f"{base}/rest/v1/error_logs",
        headers=headers,
        params={"select": "*", "order": "created_at.desc", "limit": "30"},
    )
    reports = await _request(
        "GET",
        f"{base}/rest/v1/abuse_reports",
        headers=headers,
        params={"select": "*", "order": "created_at.desc", "limit": "30"},
    )
    usage_logs = await _request(
        "GET",
        f"{base}/rest/v1/usage_logs",
        headers=headers,
        params={"select": "id,user_id,model,latency_ms,status,created_at", "order": "created_at.desc", "limit": "50"},
    )

    return {
        "users": users or [],
        "error_logs": error_logs or [],
        "abuse_reports": reports or [],
        "usage_logs": usage_logs or [],
    }


@router.patch("/users/{user_id}/status")
async def set_user_status(
    user_id: UUID,
    body: UpdateUserStatusRequest,
    admin_user: AuthenticatedUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    if str(user_id) == admin_user.id and body.status == "suspended":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot suspend your own admin account.")

    headers = _service_headers(settings)
    if not headers:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SUPABASE_SERVICE_ROLE_KEY is required for admin moderation actions.",
        )

    rows = await _request(
        "PATCH",
        f"{settings.supabase_url.rstrip('/')}/rest/v1/profiles",
        headers=headers,
        params={"id": f"eq.{user_id}"},
        json_body={"status": body.status},
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found.")
    return {"user": rows[0]}


@router.patch("/reports/{report_id}")
async def update_report_status(
    report_id: UUID,
    body: UpdateReportStatusRequest,
    _admin: AuthenticatedUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    headers = _service_headers(settings)
    if not headers:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SUPABASE_SERVICE_ROLE_KEY is required for moderation actions.",
        )

    rows = await _request(
        "PATCH",
        f"{settings.supabase_url.rstrip('/')}/rest/v1/abuse_reports",
        headers=headers,
        params={"id": f"eq.{report_id}"},
        json_body={"status": body.status},
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Abuse report not found.")
    return {"report": rows[0]}
