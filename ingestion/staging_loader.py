"""Load the tidy DataFrame into the PostgreSQL staging schema.

The Monthly A&E Sitrep XLS contains data for one or more reporting periods.
Strategy: replace rows for each affected `period` (delete-then-insert) to keep
the operation idempotent. Revision history is tracked separately in
`meta.period_version` (see metadata.py), and dbt builds the dimensional model
on top of this staging table.

Note: This loader does NOT track SCD history — that happens upstream in
metadata.upsert_period_versions(). This table represents the *latest* state
from the source file for each (period, org_code).
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from sqlalchemy.types import Date, Integer, Numeric, String, TIMESTAMP

from .logging_setup import get_logger
from .settings import settings

log = get_logger(__name__)

LANDING_TABLE = "staging.ae_activity_landing"

# Module-level constants
EXPECTED_COLUMNS = [
    "period",
    "org_code",
    "org_name",
    "attendances_type1",
    "attendances_type2",
    "attendances_type3",
    "attendances_total",
    "breaches_type1",
    "breaches_total",
    "performance_all_pct",
    "emergency_admissions_type1",
    "emergency_admissions_via_ae",
    "emergency_admissions_other",
    "emergency_admissions_total",
    "dta_breaches_4hr",
    "dta_breaches_12hr",
    "source_file_name",
    "source_file_hash",
    "source_url",
    "ingested_at",
]

DTYPE_MAPPING = {
    "period": Date(),
    "org_code": String(10),
    "org_name": String(255),
    "attendances_type1": Integer(),
    "attendances_type2": Integer(),
    "attendances_type3": Integer(),
    "attendances_total": Integer(),
    "breaches_type1": Integer(),
    "breaches_total": Integer(),
    "performance_all_pct": Numeric(5, 2),
    "emergency_admissions_type1": Integer(),
    "emergency_admissions_via_ae": Integer(),
    "emergency_admissions_other": Integer(),
    "emergency_admissions_total": Integer(),
    "dta_breaches_4hr": Integer(),
    "dta_breaches_12hr": Integer(),
    "source_file_name": String(512),
    "source_file_hash": String(64),
    "source_url": String(2048),
    "ingested_at": TIMESTAMP(timezone=True),
}

_DDL = f"""
CREATE SCHEMA IF NOT EXISTS staging;
CREATE TABLE IF NOT EXISTS {LANDING_TABLE} (
    period                    DATE,
    org_code                  VARCHAR(10),
    org_name                  VARCHAR(255),
    attendances_type1         INTEGER,
    attendances_type2         INTEGER,
    attendances_type3         INTEGER,
    attendances_total         INTEGER,
    breaches_type1            INTEGER,
    breaches_total            INTEGER,
    performance_all_pct       NUMERIC(5,2),
    emergency_admissions_type1 INTEGER,
    emergency_admissions_via_ae INTEGER,
    emergency_admissions_other INTEGER,
    emergency_admissions_total INTEGER,
    dta_breaches_4hr          INTEGER,
    dta_breaches_12hr         INTEGER,
    source_file_name          VARCHAR(512),
    source_file_hash          VARCHAR(64),
    source_url                VARCHAR(2048),
    ingested_at               TIMESTAMPTZ
);
"""

# Cached engine with connection pooling
_engine: Engine | None = None

def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(
            settings.db_url,
            future=True,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,
        )
    return _engine

# DDL guard - runs once per process
_ddl_lock = threading.Lock()
_ddl_executed = False

def _ensure_schema(conn) -> None:
    global _ddl_executed
    with _ddl_lock:
        if _ddl_executed:
            return
        for stmt in _DDL.strip().split(";"):
            if stmt.strip():
                conn.execute(text(stmt))
        _ddl_executed = True

REQUIRED_COLUMNS = frozenset({"period", "org_code", "org_name"})

def _dedupe(df: pd.DataFrame) -> pd.DataFrame:
    """Drop duplicate (period, org_code) rows, keeping the last occurrence.

    The source grid can repeat a provider (e.g. amended blocks appended at the
    bottom); the last occurrence is the most recent amendment. Without this,
    duplicates flow into staging and create two 'current' SCD versions for the
    same key.
    """
    dupes = df.duplicated(subset=["period", "org_code"])
    if not dupes.any():
        return df
    log.warning("Dropping %d duplicate (period, org_code) rows (kept last)",
                int(dupes.sum()))
    return df.drop_duplicates(subset=["period", "org_code"], keep="last")

def _validate(df: pd.DataFrame) -> None:
    """Validate input before load."""
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    
    if df.empty:
        return
    
    if df["period"].isna().any():
        raise ValueError("period is required on every row")
    
    invalid_orgs = df[df["org_code"].isna() | (df["org_code"].astype(str).str.strip() == "")]
    if not invalid_orgs.empty:
        raise ValueError(f"org_code is required; {len(invalid_orgs)} rows missing it")
    
    dupes = df.duplicated(subset=["period", "org_code"])
    if dupes.any():
        n_dupes = int(dupes.sum())
        log.warning(
            "Found %d duplicate (period, org_code) pairs; "
            "_dedupe will keep the last occurrence", n_dupes)

CHUNKSIZE = 10000

def load(df: pd.DataFrame, *, source_file_name: str, source_file_hash: str, source_url: str) -> int:
    engine = get_engine()
    now = datetime.now(timezone.utc)

    out = df.copy()
    out["source_file_name"] = source_file_name
    out["source_file_hash"] = source_file_hash
    out["source_url"] = source_url
    out["ingested_at"] = now

    # Ensure all expected columns exist (file may omit optional ones)
    for col in EXPECTED_COLUMNS:
        if col not in out.columns:
            out[col] = pd.NA
    out = out[EXPECTED_COLUMNS]

    # dupe guard — check before touching the DB
    dupes = out.columns[out.columns.duplicated()].tolist()
    if dupes:
        raise ValueError(f"Duplicate columns in staging frame: {dupes}")

    # Empty DF is OK — return 0
    if out.empty:
        log.warning("Empty DataFrame passed to staging_loader.load; skipping")
        return 0

    _validate(out)
    out = _dedupe(out)

    # Replace every month present in this batch (Sitrep = one month; safe if more)
    periods = [p for p in out["period"].dropna().unique().tolist()]
    
    start_time = time.monotonic()
    
    with Session(engine, future=True) as session:
        session.execute(text("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"))
        
        # DDL (idempotent, guarded)
        _ensure_schema(session)
        
        # Delete existing rows for affected periods
        for period_value in periods:
            session.execute(
                text(f"DELETE FROM {LANDING_TABLE} WHERE period = :p"),
                {"p": period_value},
            )
        
        # Bulk insert via parameterized SQL
        insert_sql = text(f"""
            INSERT INTO {LANDING_TABLE} ({", ".join(EXPECTED_COLUMNS)})
            VALUES ({", ".join(f":{c}" for c in EXPECTED_COLUMNS)})
        """)
        
        rows = out.to_dict("records")
        for chunk_start in range(0, len(rows), CHUNKSIZE):
            chunk = rows[chunk_start:chunk_start + CHUNKSIZE]
            session.execute(insert_sql, chunk)
        
        session.commit()
    
    duration_ms = (time.monotonic() - start_time) * 1000
    log.info(
        "Staging load complete",
        extra={
            "rows_loaded": len(out),
            "table": LANDING_TABLE,
            "periods_affected": len(periods),
            "source_file_name": source_file_name,
            "source_file_hash": source_file_hash[:12],
            "duration_ms": duration_ms,
        }
    )
    return len(out)