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
            text("SELECT 1 FROM meta.source_files WHERE source_name = :source_name AND sha256 = :sha256"),
            {"source_name": source_name, "sha256": sha256}
        ).first()
        return row is not None