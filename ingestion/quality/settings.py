"""Environment-driven settings for the data quality service

Mirrors ingestion/settings.py: reads the same POSTGRES_* variables from 
the shared .env, so this service points at the identical warehouse 
without duplicating crendentials anywhere.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

def _env(key: str, default: str | None = None) -> str:
    val = os.environ.get(key, default)
    if val is None:
            raise RuntimeError(f"Missing required environment variables: {key}")
    return val

@dataclass(frozen=True)
class Settings:
    db_url: str
    postgres_host: str
    postgres_db: str

def load_settings() -> Settings:
    host = _env("POSTGRES_HOST", "postgres")
    port = _env("POSTGRES_PORT", "5432")
    user = _env("POSTGRES_USER", "nhs")
    password = _env("POSTGRES_PASSWORD", "nhs_local_pw")
    db = _env("POSTGRES_DB", "nhs_ae")
    db_url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"
    return Settings(db_url=db_url, postgres_host=host, postgres_db=db)

settings = load_settings()
