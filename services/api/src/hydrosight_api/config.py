from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven settings. Secrets come from env vars only (never committed)."""

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    api_env: str = "development"
    database_url: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
