import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings, load_environment
from app.database import init_supabase_client
from app.routes import admin, chat, conversations, users

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
# Prevent httpx from logging full request URLs or auth headers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger = logging.getLogger("orlixa.startup")

load_environment()
settings = get_settings()
supabase_client = init_supabase_client(settings)

logger.info(
    "Environment check: env_file_found=%s supabase_configured=%s openrouter_api_key_present=%s openrouter_model_configured=%s",
    settings.env_file_found,
    settings.supabase_configured,
    settings.openrouter_api_key_present,
    settings.openrouter_model_configured,
)

app = FastAPI(
    title="ORLIXA AI API",
    description="Backend API for ORLIXA AI by Orlixa Labs",
    version="1.0.0",
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(users.router)
app.include_router(conversations.router)
app.include_router(chat.router)
app.include_router(admin.router)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "orlixa-ai-backend",
        "provider": "Orlixa Labs",
        "env_file_found": settings.env_file_found,
        "supabase_url_valid": settings.supabase_url_valid,
        "supabase_anon_key_valid": settings.supabase_anon_key_valid,
        "supabase_service_role_configured": settings.supabase_service_role_configured,
        "supabase_client_initialized": supabase_client is not None,
        "supabase_configured": settings.supabase_configured,
        "openrouter_api_key_present": settings.openrouter_api_key_present,
        "openrouter_model_configured": settings.openrouter_model_configured,
        "openrouter_base_url_valid": settings.openrouter_base_url_valid,
        "openrouter_configured": settings.openrouter_configured,
        "model_name": settings.openrouter_model.strip(),
    }
