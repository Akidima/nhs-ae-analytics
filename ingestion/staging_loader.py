"""Load the tidy DataFrame into the PostgresSQL staging schema.

    The Monhtly Time Series file contains the FULL history every time, so the
    simplest correct strategy is: replace the staging landing table with the
    file's current contents (idempotent operation). Revision history is tracked 
    seperately is meta.period_version (see metadata.py), and dbt builds the dimensional 
    model on top of this staging table.
"""
from __future__ import annotations

from datetime import datetime, timezone

from pathlib import Path
from ingestion import settings
import pandas as pd
from sqlalchemy import create_engine, text

from .logging_setup import get_logger

log = get_logger(__name__)

LANDING_TABLE = "staging.ae_activity_landing"

_DDL = f"""
CREATE SCHEMA IF NOT EXISTS staging;
CREATE TABLE IF NOT EXISTS {LANDING_TABLE} (
    period                   DATE,
    org_code                 TEXT,
    org_name                 TEXT,
    attendance_type1         BIGINT,
    attendance_type2         BIGINT,
    attendance_type3         BIGINT,
    attendance_total         BIGINT,
    breaches_type1           BIGINT,
    breaches_total           BIGINT,
    performance_all_pct      NUMERIC,
    emergency_admissions_type1 BIGINT,
    emergency_admissions_via_ae BIGINT,
    emergency_admissions_other BIGINT,
    emergency_admissions_total BIGINT,
    dta_breaches_4hr           BIGINT,
    dta_breaches_12hr          BIGINT,
    -- audit columns 
    source_file_name           TEXT,
    source_file_hash           TEXT,
    source_url                 TEXT,
    ingested_at                TIMESTAMP WITH TIME ZONE
);
"""

def get_engine():
    return create_engine(settings.db_url, future=True)

def load(df: pd.DataFrame, *, source_file_name: str, source_file_hash: str, source_url: str) -> int:
    engine = get_engine()
    now = datetime.now(timezone.utc)

    out = df.copy()
    out["source_file_name"] = source_file_name
    out["source_file_hash"] = source_file_hash
    out["source_url"] = source_url
    out["ingested_at"] = now

    # Ensure all expected columns exist (file may omit optional ones)
    expected_cols = [
        "period",
        "org_code",
        "org_name",
        "attendance_type1",
        "attendance_type2",
        "attendance_type3",
        "attendance_total",
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
        "ingested_at"
    ]
    
    for col in expected_cols:
        if col not in out.columns:
            out[col] = pd.NA
        out = out[expected_cols]
    
    # Write to staging table (replace existing data)
    with engine.begin() as conn:
       for stmt in _DDL.strip().split(";"):
           if stmt.strip():
               conn.execute(text(stmt))
    conn.execute(text(f"TRUNCATE {LANDING_TABLE}"))

    out.to_sql(
        "ae_activity_landing",
        engine,
        schema="staging",
        if_exists="append",
        index=False,
        method="multi",
        chunksize=10000
    )
    log.info("Loaded %d rows into %s", len(out), LANDING_TABLE)
    return len(out)