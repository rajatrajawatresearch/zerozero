from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment (.env).

    All fields are declared per the Phase 1 inter-agent contract
    (`docs/AGENT_CONTRACTS.md` -> `zerozero_api.settings`).
    """

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # App
    APP_ENV: str = Field(default="development")
    APP_DEBUG: bool = Field(default=False)
    APP_NAME: str = Field(default="zerozero-api")
    APP_HOST: str = Field(default="0.0.0.0")
    APP_PORT: int = Field(default=8000)
    APP_BASE_URL: str = Field(default="http://localhost:8000")
    API_V1_PREFIX: str = Field(default="/api/v1")

    # Database
    DATABASE_URL: str
    DATABASE_URL_SYNC: str

    # Redis
    REDIS_URL: str

    # JWT
    JWT_SECRET: str
    JWT_ALGORITHM: str = Field(default="HS256")
    JWT_ACCESS_TTL_MINUTES: int = Field(default=15)
    JWT_REFRESH_TTL_DAYS: int = Field(default=7)

    # CORS — comma-separated in .env, parsed into list[str].
    # NoDecode prevents pydantic-settings from trying to JSON-parse the value first.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # Observability
    SENTRY_DSN: str | None = Field(default=None)

    # Payments
    PAYMENT_WEBHOOK_SECRET: str = Field(default="mock-secret")

    # Geocoding
    NOMINATIM_BASE_URL: str = Field(default="https://nominatim.openstreetmap.org")
    NOMINATIM_USER_AGENT: str = Field(default="zerozero-dev")

    # Storage
    STORAGE_DRIVER: str = Field(default="local")
    STORAGE_LOCAL_PATH: str = Field(default="./uploads")

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: Any) -> Any:
        """Parse `CORS_ORIGINS` from a comma-separated string into a list.

        Accepts:
          - list[str] (passthrough)
          - str "a,b,c" -> ["a", "b", "c"]
          - empty / None -> []
        """
        if value is None:
            return []
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            return [origin.strip() for origin in stripped.split(",") if origin.strip()]
        if isinstance(value, (list, tuple)):
            return [str(v).strip() for v in value if str(v).strip()]
        return value

    @field_validator("SENTRY_DSN", mode="before")
    @classmethod
    def _empty_sentry_dsn_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a process-wide cached Settings instance."""
    return Settings()  # type: ignore[call-arg]
