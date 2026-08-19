"""Environment-driven settings for the data quality service.

Mirrors ``ingestion/settings.py`` by reading the shared ``POSTGRES_*``
variables, so this service connects to the same warehouse without duplicating
credentials.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import quote

@dataclass(frozen=True)
class Settings:
    db_url: str
    postgres_host: str
    postgres_db: str
    postgres_port: str
    postgres_user: str


def _env(key: str, default: str | None = None) -> str:
    val = os.environ.get(key, default)
    if val is None or not val.strip():
        raise RuntimeError(f"Missing required environment variable: {key}")
    return val


def load_settings() -> Settings:
    host = _env("POSTGRES_HOST", "postgres")
    port = _env("POSTGRES_PORT", "5432")
    user = _env("POSTGRES_USER", "nhs")
    # No default: fail fast when database credentials are not configured.
    password = _env("POSTGRES_PASSWORD")
    db = _env("POSTGRES_DB", "nhs_ae")

    # Escape credentials before placing them in a URL. This permits valid
    # passwords such as ``my@password`` and avoids changing URL semantics.
    db_url = (
        "postgresql+psycopg2://"
        f"{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}/{db}"
    )

    return Settings(
        db_url=db_url,
        postgres_host=host,
        postgres_db=db,
        postgres_port=port,
        postgres_user=user,
    )

settings = load_settings()
