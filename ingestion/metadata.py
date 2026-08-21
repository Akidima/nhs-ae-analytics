"""Write to the meta.* catalog: file records, revision history, run audit.

This is what turns the pipeline from "a script" into "a platform" - it can
answer "did this number change, or did the source change?" 
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from enum import Enum

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from .hashing import row_hash
from .logging_setup import get_logger

log = get_logger(__name__)

_MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")

# Columns excluded from row hashing (metadata columns)
EXCLUDED_HASH_COLUMNS = frozenset({
    "source_file_name", "source_file_hash", "source_url", "ingested_at"
})


class IngestStatus(str, Enum):
    """Valid ingestion status values for source_file.ingest_status."""
    PENDING = "pending"
    LOADING = "loading"
    LOADED = "loaded"
    FAILED = "failed"
    SKIPPED_DUPLICATE = "skipped_duplicate"
    SKIPPED_UNCHANGED = "skipped_unchanged"


def _normalize_data_month(data_month) -> date:
    """Accept YYYY-MM string, date, or datetime; return first day of month as date."""
    if isinstance(data_month, date) and not isinstance(data_month, datetime):
        return data_month.replace(day=1)
    if isinstance(data_month, datetime):
        return data_month.date().replace(day=1)
    if isinstance(data_month, str):
        if not _MONTH_PATTERN.match(data_month):
            raise ValueError(f"data_month must be YYYY-MM format, got: {data_month}")
        year, month = map(int, data_month.split("-"))
        return date(year, month, 1)
    raise TypeError(f"data_month must be str (YYYY-MM), date, or datetime; got {type(data_month)}")


def already_ingested(engine: Engine, source_name: str, sha256: str) -> bool:
    """Level-1 change detection: have we already loaded these exact bytes?"""
    with engine.connect() as conn: 
        row = conn.execute(
            text("SELECT 1 FROM meta.source_file WHERE source_name = :source_name AND sha256 = :sha256"),
            {"source_name": source_name, "sha256": sha256}
        ).first()
        return row is not None


def record_source_file(engine: Engine, *, source_name: str, filename: str, 
                        url: str, sha256: str, size_bytes: int,
                        schema_version: str, raw_key: str, row_count: int,
                        data_month: str | date | datetime, status: str | IngestStatus) -> int:
    if isinstance(status, IngestStatus):
        status = status.value
    data_month_norm = _normalize_data_month(data_month)
    params = {
        "source_name": source_name,
        "filename": filename,
        "url": url,
        "data_month": data_month_norm,
        "size": size_bytes,
        "sha256": sha256,
        "schema_version": schema_version,
        "raw_key": raw_key,
        "row_count": row_count,
        "status": status,
    }
    with engine.begin() as conn:
        sid = conn.execute(
            text("""
                INSERT INTO meta.source_file
                (source_name, original_filename, resolved_url, data_month,
                file_size_bytes, sha256, schema_version, raw_storage_path,
                row_count_parsed, ingest_status)
                VALUES
                    (:source_name, :filename, :url, :data_month,
                    :size, :sha256, :schema_version, :raw_key, :row_count, :status)
                ON CONFLICT (source_name, sha256) DO NOTHING
                RETURNING source_file_id
            """),
            params,
        ).first()
        if sid is None:
            # Already catalogued — look up the existing id (never invent -1).
            sid = conn.execute(
                text("""
                    SELECT source_file_id FROM meta.source_file
                    WHERE source_name = :source_name AND sha256 = :sha256
                """),
                {"source_name": source_name, "sha256": sha256},
            ).first()
        if sid is None:
            raise RuntimeError(
                f"Could not resolve source_file_id for {source_name}/{sha256}"
            )
        log.info(
            "Source file recorded",
            extra={
                "source_file_id": int(sid[0]),
                "source_name": source_name,
                "original_filename": filename,
                "status": status,
            }
        )
        return int(sid[0])


def upsert_period_versions(engine: Engine, df: pd.DataFrame,
                            source_file_id: int) -> int:
    """Level-2/3 revision detection via SCD-style row hashing (batch version)."""
    if not {"period", "org_code"}.issubset(set(df.columns)):
        return 0
    
    # Deterministic column order: sort columns alphabetically for consistent hashing
    value_cols = sorted(c for c in df.columns if c not in EXCLUDED_HASH_COLUMNS)
    
    # Prepare records
    now = datetime.now(timezone.utc)
    records = []
    for _, r in df.iterrows():
        if pd.isna(r.get("org_code")) or pd.isna(r.get("period")):
            continue
        rh = row_hash(r[c] for c in value_cols)
        period_val = r["period"]
        if isinstance(period_val, datetime):  # covers pd.Timestamp too
            period_val = period_val.date()
        records.append({
            "source_file_id": source_file_id,
            "period": period_val,
            "org_code": str(r["org_code"]),
            "row_hash": rh,
        })
    
    if not records:
        return 0
    
    # Batch upsert using CTE with temporary table
    with engine.begin() as conn:
        # Create temp table with new data
        conn.execute(text("""
            CREATE TEMP TABLE tmp_new_versions (
                source_file_id INTEGER,
                period DATE,
                org_code TEXT,
                row_hash TEXT
            ) ON COMMIT DROP
        """))
        
        conn.execute(text("""
            INSERT INTO tmp_new_versions (source_file_id, period, org_code, row_hash)
            VALUES (:source_file_id, :period, :org_code, :row_hash)
        """), records)
        
        # Expire changed rows (where hash differs)
        expire_result = conn.execute(text("""
            UPDATE meta.period_version pv
            SET is_current = false, valid_to = :now
            FROM tmp_new_versions nv
            WHERE pv.period = nv.period
              AND pv.org_code = nv.org_code
              AND pv.is_current = true
              AND pv.row_hash != nv.row_hash
        """), {"now": now})
        
        # Insert new/changed rows (where no current row exists OR hash differs)
        insert_result = conn.execute(text("""
            INSERT INTO meta.period_version (source_file_id, period, org_code, row_hash, is_current)
            SELECT nv.source_file_id, nv.period, nv.org_code, nv.row_hash, true
            FROM tmp_new_versions nv
            LEFT JOIN meta.period_version pv
              ON pv.period = nv.period
             AND pv.org_code = nv.org_code
             AND pv.is_current = true
            WHERE pv.row_hash IS NULL OR pv.row_hash != nv.row_hash
        """))
        
        changed = insert_result.rowcount
        log.info(
            "Revision check complete",
            extra={
                "changed_rows": changed,
                "source_file_id": source_file_id,
                "expired_rows": expire_result.rowcount,
            }
        )
        return changed


def start_run(engine: Engine, dag_run_id: str | None = None) -> int:
    with engine.begin() as conn:
        rid = conn.execute(
            text("""INSERT INTO meta.pipeline_run (dag_run_id, status) 
                    VALUES (:d, 'running') RETURNING run_id"""),
            {"d": dag_run_id},
        ).first()
    return int(rid[0])


def finish_run(engine: Engine, run_id: int, *, status: str,
               rows_loaded: int | None = None, notes: str | None = None) -> None:
    with engine.begin() as conn:
        result = conn.execute(
            text("""UPDATE meta.pipeline_run
                    SET status = :s, finished_at = :f,
                        rows_loaded = :r, notes = :n
                    WHERE run_id = :id"""),
            {"s": status, "f": datetime.now(timezone.utc),
             "r": rows_loaded, "n": notes, "id": run_id},
        )
        if result.rowcount == 0:
            raise ValueError(f"No pipeline_run found with run_id={run_id}")
    log.info(
        "Pipeline run finished",
        extra={
            "run_id": run_id,
            "status": status,
            "rows_loaded": rows_loaded,
        }
    )