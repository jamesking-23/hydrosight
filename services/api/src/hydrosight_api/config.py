from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven settings. Secrets come from env vars only (never committed)."""

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    api_env: str = "development"
    database_url: str = ""
    # CAP "sender" is <org-slug>@<this domain>; placeholder until an official ID is registered.
    cap_sender_domain: str = "hydrosight.example"
    # Comma-separated web origins allowed to call the API from a browser (e.g. the community app).
    cors_allow_origins: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
