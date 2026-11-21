from functools import lru_cache
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
BACKEND_ENV_FILE = BACKEND_DIR / ".env"
ROOT_ENV_FILE = PROJECT_ROOT / ".env"


def resolve_env_files() -> List[Path]:
    """Return existing .env files in priority order (backend/.env first, then repo root .env)."""
    found: List[Path] = []
    for candidate in (BACKEND_ENV_FILE, ROOT_ENV_FILE):
        if candidate.is_file():
            found.append(candidate)
    return found


def load_environment() -> Optional[Path]:
    """Load environment variables via python-dotenv without overwriting real process env vars."""
    files = resolve_env_files()
    for env_path in files:
        load_dotenv(dotenv_path=env_path, override=False)
    return files[0] if files else None


load_environment()


def is_valid_supabase_url(raw_url: str) -> bool:
    cleaned = raw_url.strip()
    if not cleaned or "your-project-ref" in cleaned:
        return False
    parsed = urlparse(cleaned)
    if parsed.scheme == "https" and bool(parsed.netloc):
        return True
    if parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost"):
        return True
    return False


def is_valid_supabase_key(raw_key: str) -> bool:
    cleaned = raw_key.strip()
    if not cleaned or "your-supabase-anon" in cleaned or "your-supabase-service-role" in cleaned:
        return False
    if cleaned.startswith("sb_publishable_") or cleaned.startswith("sb_secret_"):
        return len(cleaned) > 20
    parts = cleaned.split(".")
    return len(parts) == 3 and all(len(p) > 0 for p in parts)


def is_valid_openrouter_base_url(raw_url: str) -> bool:
    cleaned = raw_url.strip()
    if not cleaned:
        return False
    parsed = urlparse(cleaned)
    return parsed.scheme == "https" and bool(parsed.netloc)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[str(BACKEND_ENV_FILE), str(ROOT_ENV_FILE)],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = Field(default="development")
    port: int = Field(default=8000)

    supabase_url: str = Field(default="")
    supabase_anon_key: str = Field(default="")
    supabase_service_role_key: str = Field(default="")

    openrouter_api_key: str = Field(default="")
    openrouter_model: str = Field(default="nvidia/nemotron-3-ultra-550b-a55b:free")
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1")
    openrouter_site_url: str = Field(default="")
    openrouter_app_name: str = Field(default="ORLIXA AI")

    ai_temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    allowed_origins: str = Field(default="http://localhost:3000")
    rate_limit_requests_per_minute: int = Field(default=20, ge=1, le=300)
    max_message_length: int = Field(default=4000, ge=100, le=32000)
    max_output_tokens: int = Field(default=2048, ge=64, le=16384)
    max_context_messages: int = Field(default=20, ge=2, le=100)
    ai_request_timeout_seconds: int = Field(default=120, ge=10, le=600)

    @property
    def cors_origins(self) -> List[str]:
        return [
            origin.strip().rstrip("/")
            for origin in self.allowed_origins.split(",")
            if origin.strip()
        ]

    @property
    def env_file_found(self) -> bool:
        return len(resolve_env_files()) > 0

    @property
    def supabase_url_valid(self) -> bool:
        return is_valid_supabase_url(self.supabase_url)

    @property
    def supabase_anon_key_valid(self) -> bool:
        return is_valid_supabase_key(self.supabase_anon_key)

    @property
    def supabase_service_role_configured(self) -> bool:
        return is_valid_supabase_key(self.supabase_service_role_key)

    @property
    def supabase_configured(self) -> bool:
        return self.supabase_url_valid and self.supabase_anon_key_valid

    @property
    def openrouter_api_key_present(self) -> bool:
        key = self.openrouter_api_key.strip()
        return bool(key) and "your-openrouter" not in key.lower()

    @property
    def openrouter_model_configured(self) -> bool:
        return bool(self.openrouter_model.strip())

    @property
    def openrouter_base_url_valid(self) -> bool:
        return is_valid_openrouter_base_url(self.openrouter_base_url)

    @property
    def openrouter_configured(self) -> bool:
        return (
            self.openrouter_api_key_present
            and self.openrouter_model_configured
            and self.openrouter_base_url_valid
        )


@lru_cache
def get_settings() -> Settings:
    load_environment()
    return Settings()
