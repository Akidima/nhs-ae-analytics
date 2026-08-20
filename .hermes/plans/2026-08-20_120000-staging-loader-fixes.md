# Staging Loader Improvements Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix critical/high-severity issues in `ingestion/staging_loader.py` including transaction atomicity, DDL safety, empty DataFrame handling, validation, and type optimization.

**Architecture:** The staging loader writes parsed A&E data to `staging.ae_activity_landing` table. Current implementation has transaction atomicity bug (to_sql opens own transactions), DDL runs every call, empty DF raises instead of returning 0, and uses BIGINT where INTEGER suffices.

**Tech Stack:** Python, pandas, SQLAlchemy, PostgreSQL, pytest

---

### Task 1: Save plan and add module-level constants

**Objective:** Extract expected columns and dtype mapping to module-level constants

**Files:**
- Modify: `ingestion/staging_loader.py:41-62` (expected_cols → EXPECTED_COLUMNS constant)
- Modify: `ingestion/staging_loader.py` (add DTYPE_MAPPING constant)
- Test: `tests/test_staging_loader.py`

**Step 1: Write failing test**

```python
def test_expected_columns_constant_exists():
    from ingestion.staging_loader import EXPECTED_COLUMNS
    assert isinstance(EXPECTED_COLUMNS, (list, tuple))
    assert len(EXPECTED_COLUMNS) == 20
    assert "period" in EXPECTED_COLUMNS
    assert "org_code" in EXPECTED_COLUMNS
    assert "source_file_name" in EXPECTED_COLUMNS

def test_dtype_mapping_constant_exists():
    from ingestion.staging_loader import DTYPE_MAPPING
    assert isinstance(DTYPE_MAPPING, dict)
    assert DTYPE_MAPPING["period"].__visit_name__ == "DATE"
    assert DTYPE_MAPPING["org_code"].__visit_name__ == "VARCHAR"
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_expected_columns_constant_exists -v`
Expected: FAIL — constants not defined

**Step 3: Write minimal implementation**

```python
# Module-level constants
EXPECTED_COLUMNS = [
    "period", "org_code", "org_name",
    "attendances_type1", "attendances_type2", "attendances_type3", "attendances_total",
    "breaches_type1", "breaches_total",
    "performance_all_pct",
    "emergency_admissions_type1", "emergency_admissions_via_ae",
    "emergency_admissions_other", "emergency_admissions_total",
    "dta_breaches_4hr", "dta_breaches_12hr",
    "source_file_name", "source_file_hash", "source_url", "ingested_at",
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
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_expected_columns_constant_exists -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py tests/test_staging_loader.py
git commit -m "refactor: extract EXPECTED_COLUMNS and DTYPE_MAPPING constants"
```

---

### Task 2: Fix empty DataFrame handling (return 0 instead of raising)

**Objective:** Empty input should return 0 rows loaded, not raise ValueError

**Files:**
- Modify: `ingestion/staging_loader.py:60-62`
- Test: `tests/test_staging_loader.py`

**Step 1: Write failing test**

```python
def test_empty_dataframe_returns_zero():
    from ingestion.staging_loader import load
    import pandas as pd
    
    empty_df = pd.DataFrame()
    # Mock engine to avoid DB call
    result = load(engine=mock_engine, df=empty_df, source_file_name="test.xls", 
                  source_file_hash="abc", source_url="http://test")
    assert result == 0
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_empty_dataframe_returns_zero -v`
Expected: FAIL — raises ValueError

**Step 3: Write minimal implementation**

```python
if out.empty:
    log.warning("Empty DataFrame passed to staging_loader.load; skipping")
    return 0
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_empty_dataframe_returns_zero -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py tests/test_staging_loader.py
git commit -m "fix: return 0 for empty DataFrame instead of raising"
```

---

### Task 3: Add input validation helper

**Objective:** Validate required columns, period, org_code before load

**Files:**
- Modify: `ingestion/staging_loader.py` (add `_validate()` function)
- Test: `tests/test_staging_loader.py`

**Step 1: Write failing test**

```python
def test_validate_rejects_missing_required_columns():
    from ingestion.staging_loader import _validate
    import pandas as pd
    
    df = pd.DataFrame({"period": ["2024-01-01"]})  # missing org_code, org_name
    with pytest.raises(ValueError, match="Missing required columns"):
        _validate(df)

def test_validate_rejects_nan_period():
    from ingestion.staging_loader import _validate
    import pandas as pd
    import numpy as np
    
    df = pd.DataFrame({"period": [np.nan], "org_code": ["R1H"], "org_name": ["Test"]})
    with pytest.raises(ValueError, match="period is required"):
        _validate(df)

def test_validate_rejects_empty_org_code():
    from ingestion.staging_loader import _validate
    import pandas as pd
    
    df = pd.DataFrame({"period": ["2024-01-01"], "org_code": [""], "org_name": ["Test"]})
    with pytest.raises(ValueError, match="org_code is required"):
        _validate(df)
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_validate_rejects_missing_required_columns -v`
Expected: FAIL — `_validate` not defined

**Step 3: Write minimal implementation**

```python
REQUIRED_COLUMNS = frozenset({"period", "org_code", "org_name"})

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
        n_dupes = dupes.sum()
        log.warning("Found %d duplicate (period, org_code) pairs; will be deduped", n_dupes)
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_validate_rejects_missing_required_columns -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py tests/test_staging_loader.py
git commit -m "feat: add input validation with clear error messages"
```

---

### Task 4: Fix transaction atomicity - use proper Session with explicit transaction

**Objective:** Ensure DELETE + INSERT are atomic; to_sql must not commit independently

**Files:**
- Modify: `ingestion/staging_loader.py:66-87` (replace with Session-based approach)
- Test: `tests/test_staging_loader.py`

**Step 1: Write failing test**

```python
def test_load_is_atomic_on_failure():
    """If INSERT fails, DELETE should be rolled back."""
    from ingestion.staging_loader import load
    import pandas as pd
    from unittest.mock import patch
    
    df = pd.DataFrame([{
        "period": "2024-01-01", "org_code": "R1H", "org_name": "Test",
        "attendances_total": 100, "source_file_name": "test.xls",
        "source_file_hash": "abc", "source_url": "http://test", "ingested_at": pd.Timestamp.now()
    }])
    
    # Mock engine to simulate failure during INSERT
    with patch("ingestion.staging_loader.get_engine") as mock_get_engine:
        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_session.execute.side_effect = [None, Exception("DB error")]
        
        with pytest.raises(Exception):
            load(engine=mock_get_engine.return_value, df=df, 
                 source_file_name="test.xls", source_file_hash="abc", source_url="http://test")
        
        # Verify rollback was called
        mock_session.rollback.assert_called()
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_load_is_atomic_on_failure -v`
Expected: FAIL — current implementation commits DELETE before INSERT fails

**Step 3: Write minimal implementation**

```python
from sqlalchemy.orm import Session

def load(engine: Engine, *, df: pd.DataFrame, source_file_name: str, 
         source_file_hash: str, source_url: str) -> int:
    # ... prep code ...
    
    _validate(out)
    
    periods = out["period"].dropna().unique().tolist()
    
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
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_load_is_atomic_on_failure -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py tests/test_staging_loader.py
git commit -m "fix: atomic load using Session with explicit transaction"
```

---

### Task 5: DDL safety guard - run once per process

**Objective:** Prevent DDL from running on every load call

**Files:**
- Modify: `ingestion/staging_loader.py` (add `_ddl_executed` flag and `_ensure_schema`)
- Test: `tests/test_staging_loader.py`

**Step 1: Write failing test**

```python
def test_ddl_runs_once():
    from ingestion.staging_loader import _ensure_schema
    from unittest.mock import MagicMock
    
    mock_conn = MagicMock()
    _ensure_schema(mock_conn)
    _ensure_schema(mock_conn)  # Second call
    
    # DDL statements should only execute once
    assert mock_conn.execute.call_count == len([s for s in _DDL.strip().split(";") if s.strip()])
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_ddl_runs_once -v`
Expected: FAIL — no guard

**Step 3: Write minimal implementation**

```python
import threading

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
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_ddl_runs_once -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py tests/test_staging_loader.py
git commit -m "perf: DDL runs once per process with thread-safe guard"
```

---

### Task 6: Change BIGINT to INTEGER in schema

**Objective:** Reduce storage by 50% for count columns

**Files:**
- Modify: `ingestion/staging_loader.py` (update _DDL schema)
- Note: Requires migration for existing tables

**Step 1: Write failing test**

```python
def test_schema_uses_integer_not_bigint():
    from ingestion.staging_loader import _DDL
    assert "INTEGER" in _DDL
    assert "BIGINT" not in _DDL
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_schema_uses_integer_not_bigint -v`
Expected: FAIL — currently uses BIGINT

**Step 3: Write minimal implementation**

```python
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
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_schema_uses_integer_not_bigint -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py tests/test_staging_loader.py
git commit -m "perf: change count columns from BIGINT to INTEGER"
```

---

### Task 7: Structured logging with correlation fields

**Objective:** Add structured logging with source_file_name, duration_ms, etc.

**Files:**
- Modify: `ingestion/staging_loader.py` (update log.info call)
- Test: `tests/test_staging_loader.py`

**Step 1: Write failing test**

```python
def test_structured_logging_contains_correlation_fields():
    from ingestion.staging_loader import load
    from unittest.mock import MagicMock, patch
    import pandas as pd
    
    df = pd.DataFrame([{
        "period": "2024-01-01", "org_code": "R1H", "org_name": "Test",
        "attendances_total": 100, "source_file_name": "test.xls",
        "source_file_hash": "abc", "source_url": "http://test", "ingested_at": pd.Timestamp.now()
    }])
    
    with patch("ingestion.staging_loader.get_engine") as mock_get_engine:
        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        
        with patch("ingestion.staging_loader.log") as mock_log:
            load(engine=mock_get_engine.return_value, df=df,
                 source_file_name="test.xls", source_file_hash="abc", source_url="http://test")
            
            call_args = mock_log.info.call_args
            assert call_args is not None
            extra = call_args.kwargs.get("extra", {})
            assert extra["source_file_name"] == "test.xls"
            assert "duration_ms" in extra
            assert "periods_affected" in extra
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_structured_logging_contains_correlation_fields -v`
Expected: FAIL — old logging format

**Step 3: Write minimal implementation**

```python
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
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_structured_logging_contains_correlation_fields -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py tests/test_staging_loader.py
git commit -m "feat: structured logging with correlation IDs"
```

---

### Task 8: Cached engine with connection pooling

**Objective:** Reuse engine across calls with proper pooling

**Files:**
- Modify: `ingestion/staging_loader.py:36-37` (get_engine with caching)
- Test: `tests/test_staging_loader.py`

**Step 1: Write failing test**

```python
def test_get_engine_returns_same_instance():
    from ingestion.staging_loader import get_engine
    
    engine1 = get_engine()
    engine2 = get_engine()
    assert engine1 is engine2
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_get_engine_returns_same_instance -v`
Expected: FAIL — creates new engine each call

**Step 3: Write minimal implementation**

```python
from sqlalchemy.engine import Engine

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
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_get_engine_returns_same_instance -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py tests/test_staging_loader.py
git commit -m "perf: cached engine with connection pooling"
```

---

### Task 9: Fix docstring typos and misleading comments

**Objective:** Clean up documentation

**Files:**
- Modify: `ingestion/staging_loader.py:1-15` (docstring)

**Step 1: Write failing test**

```python
def test_docstring_has_no_typos():
    from ingestion.staging_loader import load
    doc = load.__doc__
    assert "Monhtly" not in doc
    assert "seperately" not in doc
    assert "FULL history" not in doc  # misleading comment removed
```

**Step 2: Run test to verify failure**

Run: `pytest tests/test_staging_loader.py::test_docstring_has_no_typos -v`
Expected: FAIL — typos exist

**Step 3: Write minimal implementation**

```python
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
```

**Step 4: Run test to verify pass**

Run: `pytest tests/test_staging_loader.py::test_docstring_has_no_typos -v`
Expected: PASS

**Step 5: Commit**

```bash
git add ingestion/staging_loader.py
git commit -m "docs: fix typos and clarify staging loader behavior"
```

---

### Task 10: Integration test - idempotency

**Objective:** Verify loading same data twice produces same result

**Files:**
- Test: `tests/integration/test_staging_idempotency.py`

**Step 1: Write failing test**

```python
def test_load_idempotent_same_file_twice(test_db):
    """Loading same file twice should not duplicate rows."""
    from ingestion.staging_loader import load
    import pandas as pd
    
    df = pd.DataFrame([{
        "period": "2024-01-01", "org_code": "R1H", "org_name": "Test Trust",
        "attendances_total": 1000, "breaches_total": 50,
        "performance_all_pct": 95.0,
        "source_file_name": "test.xls", "source_file_hash": "abc123",
        "source_url": "http://test", "ingested_at": pd.Timestamp.now()
    }])
    
    # First load
    count1 = load(engine=test_db, df=df, source_file_name="test.xls",
                  source_file_hash="abc123", source_url="http://test")
    
    # Second load (same hash)
    count2 = load(engine=test_db, df=df, source_file_name="test.xls",
                  source_file_hash="abc123", source_url="http://test")
    
    assert count1 == count2 == 1
    
    # Verify only one row in DB
    with test_db.connect() as conn:
        result = conn.execute(text("SELECT COUNT(*) FROM staging.ae_activity_landing"))
        assert result.scalar() == 1
```

**Step 2: Run test to verify failure**

Run: `pytest tests/integration/test_staging_idempotency.py -v`
Expected: FAIL — current implementation may not handle duplicates correctly

**Step 3: Verify fix**

The DELETE by period ensures idempotency. Test should pass with our atomic implementation.

**Step 4: Run test to verify pass**

Run: `pytest tests/integration/test_staging_idempotency.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/integration/test_staging_idempotency.py
git commit -m "test: integration test for idempotent load"
```

---

### Task 11: Run full test suite and verify all passes

**Objective:** All tests pass, no regressions

**Files:**
- All test files

**Step 1: Run all tests**

Run: `pytest tests/ -v`
Expected: All tests pass

**Step 2: Run integration tests with Docker**

Run: `docker compose run --rm ingestion python -m pytest tests/ -v`
Expected: All tests pass

**Step 3: Commit any final fixes**

```bash
git add .
git commit -m "test: all tests passing"
```

---

### Task 12: Push and create PR

**Objective:** Push branch and create PR for review

**Commands:**
```bash
git push origin cursor/staging-loader-fixes
# Create PR via GitHub CLI or web
```

---

## Summary

| Priority | Tasks | Focus |
|----------|-------|-------|
| **Critical** | 2, 4 | Transaction atomicity, empty DF handling |
| **High** | 1, 3, 5, 6, 7 | Constants, validation, DDL guard, INTEGER types, structured logging |
| **Medium** | 8, 9 | Cached engine, docstring fixes |
| **Integration** | 10, 11 | Idempotency, full test suite |
| **Delivery** | 12 | Push + PR |

**Total: 12 tasks, ~2-5 min each = 24-60 min implementation time**