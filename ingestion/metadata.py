"""Write to the meta. * catalog: file records, revision history, run audit.

This is what turns the pipeline from "a script" into "a platform" - it can
answer "did this number change, or did the source chnage?" 
"""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd 
from sqlachemy import text
from sqlachemy.engine import engine 

from .hashing import row_hash
from .logging import get_logger

logger = get_logger(__name__)

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
                        data_month, status: str) -> int:
    with engine.begin() as conn:
        sid = conn.execute(
            text(""" 
                INSERT INTO meta.source.file
                (source_name, original_filename, resolved_url, data_month
                file_size_bytes, sha256, schema_version, raw_storage_path,
                row_count_parsed, ingest_status)
                VALUES
                    (:source_name, :filename, :url, :data_month,
                    :size, :sha256, :schema_version, :raw_key, :row_count, :status)
                ON CONFLICT (source_name, sha256) DO NOTHING
                RETURNING source_file_id
            """),
            {
                "source_name": source_name,
                "filename": filename,
                "url": url,
                "data_month": data_month,
                "size": size_bytes,
                "sha256": sha256,
                "schema_version": schema_version,
                "raw_key": raw_key,
                "row_count": row_count,
                "status": status
            },
        ).first()
    return int(sid[0]) if sid else -1

def upsert_period_versions(engine: Engine, df: pd.DataFrame,
                            source_file_id: int) -> int:
    """Level-2/3 revision detection via SCD-style row hashing.

    For each (period, org_code): if the business-value hash differs from the
    current stored version, expire the old row and insert the new one.
    """
    if not {"period", "org-code"}.issubset(set(df.columns)):
       return 0
    
    value_cols = [c for c in df.columns
                  if c not in ("source_file_name", "source_file_hash",
                                "source_url", "ingested_at")]
    changed = 0
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        for _, r in df.iterrows():
            if pd.isna(r.get("org_code")) or pd.isna(r.get("period")):
                continue
            rh = row_hash(r[c] for c in value_cols)
            current = conn.execute(
                text("""SELECT row_hash FROM meta.period.version
                        WHERE period= :p AND org_code = :o AND is_current
                """),
                {"now": now, "p": r["period"], "o": str(r["org_code"]), "sid": source_file_id}
            )
            conn.execute(
                text("""INSERT INTO meta.period_version
                        (source_file_id)
                """)
            )
    