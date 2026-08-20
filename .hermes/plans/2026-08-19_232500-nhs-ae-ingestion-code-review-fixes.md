# NHS A&E Ingestion Pipeline — Code Review Fixes Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Address critical/high/medium findings from code review of `ingestion/link_resolver.py` and `ingestion/metadata.py` to improve reliability, maintainability, and production readiness.

**Architecture:** Two-file ingestion pipeline — `link_resolver.py` scrapes NHS England WordPress pages to discover XLS download URLs; `metadata.py` manages PostgreSQL metadata catalog with SHA256 deduplication and SCD Type 2 row versioning.

**Tech Stack:** Python 3.11+, requests, BeautifulSoup4, pandas, SQLAlchemy, PostgreSQL

---

## Task Breakdown

### Task 1: Consolidate URL Normalization in link_resolver.py

**Objective:** Remove duplicate `_abs_url()` logic in `resolve_timeseries_url()` and use the helper everywhere.

**Files:**
- Modify: `ingestion/link_resolver.py:103-107,130-133`

**Step 1: Write failing test**

```python
# tests/test_link_resolver.py
def test_abs_url_normalization():
    from ingestion.link_resolver import _abs_url
    
    assert _abs_url("/path/file.xls") == "https://www.england.nhs.uk/path/file.xls"
    assert _abs_url("//example.com/file.xls") == "https://example.com/file.xls"
    assert _abs_url("https://example.com/file.xls") == "https://example.com/file.xls"
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_link_resolver.py::test_abs_url_normalization -v
# Expected: FAIL — function not accessible or wrong behavior
```

**Step 3: Apply fix**

Replace inline URL normalization in `resolve_timeseries_url()` (lines 103-107, 130-133) with `_abs_url(href)` calls.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_link_resolver.py::test_abs_url_normalization -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/link_resolver.py tests/test_link_resolver.py
git commit -m "refactor: consolidate URL normalization to _abs_url helper"
```

---

### Task 2: Make Search Patterns Configurable in link_resolver.py

**Objective:** Move hardcoded regex patterns for "Monthly A&E", "Time Series", etc. to `settings.py` for maintainability.

**Files:**
- Modify: `ingestion/link_resolver.py:73-79,112-113`
- Modify: `ingestion/settings.py` (add new config fields)

**Step 1: Write failing test**

```python
# tests/test_link_resolver.py
def test_category_patterns_from_settings(monkeypatch):
    from ingestion import settings
    from ingestion.link_resolver import resolve_timeseries_url
    
    # Verify settings has the new pattern fields
    assert hasattr(settings, 'CATEGORY_PAGE_PATTERNS')
    assert hasattr(settings, 'XLS_LINK_PATTERNS')
    assert hasattr(settings, 'EXCLUDE_PATTERNS')
    assert isinstance(settings.CATEGORY_PAGE_PATTERNS, list)
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_link_resolver.py::test_category_patterns_from_settings -v
# Expected: FAIL — attributes don't exist yet
```

**Step 3: Apply fix**

1. Add to `settings.py`:
```python
CATEGORY_PAGE_PATTERNS = [
    r"Monthly\s+A[&]?E\s+Attendances\s+and\s+Emergency\s+Admissions",
    r"Monthly\s+AE\s+Attendances\s+and\s+Emergency\s+Admissions",
]
XLS_LINK_PATTERNS = [
    r"monthly\s+a[&]?e",
    r"monthly\s+ae",
]
EXCLUDE_PATTERNS = [
    r"time\s+series",
    r"ecds",
    r"quarterly",
]
```

2. Update `link_resolver.py` to compile and use these patterns.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_link_resolver.py::test_category_patterns_from_settings -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/settings.py ingestion/link_resolver.py tests/test_link_resolver.py
git commit -m "feat: make scraper patterns configurable via settings"
```

---

### Task 3: Dynamic Year-Page Discovery for Backfill

**Objective:** Replace hardcoded `_BACKFILL_YEAR_PAGES` with dynamic discovery from landing page.

**Files:**
- Modify: `ingestion/link_resolver.py:19-22,40-70`
- Create: `tests/fixtures/landing_page.html`

**Step 1: Write failing test**

```python
# tests/test_link_resolver.py
def test_discover_year_pages(mock_landing_page):
    from ingestion.link_resolver import discover_year_pages
    
    pages = discover_year_pages("https://fake.example.com/landing")
    assert len(pages) >= 2
    assert all("ae-attendances-and-emergency-admissions-" in p for p in pages)
    assert pages == sorted(pages, reverse=True)  # newest first
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_link_resolver.py::test_discover_year_pages -v
# Expected: FAIL — function doesn't exist
```

**Step 3: Apply fix**

Add `discover_year_pages()` function (see proposed code in review) and update `resolve_backfill_urls()` to use it.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_link_resolver.py::test_discover_year_pages -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/link_resolver.py tests/test_link_resolver.py tests/fixtures/landing_page.html
git commit -m "feat: add dynamic year-page discovery for backfill"
```

---

### Task 4: Polite Scraping — Rate Limiting & robots.txt

**Objective:** Add request delays and robots.txt compliance.

**Files:**
- Modify: `ingestion/link_resolver.py` (top imports, `_fetch_html`)

**Step 1: Write failing test**

```python
# tests/test_link_resolver.py
def test_fetch_html_respects_robots_txt(monkeypatch):
    from ingestion.link_resolver import _fetch_html, _can_fetch
    
    # Mock robots.txt that disallows our user agent
    # Verify _can_fetch returns False for disallowed paths
    assert _can_fetch("https://example.com/allowed") is True
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_link_resolver.py::test_fetch_html_respects_robots_txt -v
# Expected: FAIL — _can_fetch doesn't exist
```

**Step 3: Apply fix**

Add `_can_fetch()`, `_ROBOTS_CACHE`, `_MIN_DELAY_SECONDS`, and update `_fetch_html()` per proposed code.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_link_resolver.py::test_fetch_html_respects_robots_txt -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/link_resolver.py tests/test_link_resolver.py
git commit -m "feat: add robots.txt compliance and polite request delays"
```

---

### Task 5: Fallback to Previous Year on 404

**Objective:** If current year category page returns 404, automatically try previous financial year.

**Files:**
- Modify: `ingestion/link_resolver.py:110-140`

**Step 1: Write failing test**

```python
# tests/test_link_resolver.py
def test_fallback_to_previous_year_on_404(mock_category_pages):
    from ingestion.link_resolver import resolve_timeseries_url
    
    # First call returns 404, second returns valid page with XLS
    result = resolve_timeseries_url()
    assert result.url.endswith(".xls")
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_link_resolver.py::test_fallback_to_previous_year_on_404 -v
# Expected: FAIL — no fallback logic
```

**Step 3: Apply fix**

Wrap category page fetch in loop with `[category_url, _previous_year_url(category_url)]` and handle 404.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_link_resolver.py::test_fallback_to_previous_year_on_404 -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/link_resolver.py tests/test_link_resolver.py tests/fixtures/category_page_404.html
git commit -m "feat: add previous-year fallback when category page 404s"
```

---

### Task 6: Deterministic Column Order for Row Hashing

**Objective:** Sort `value_cols` alphabetically before hashing to prevent false change detection.

**Files:**
- Modify: `ingestion/metadata.py:63-66`

**Step 1: Write failing test**

```python
# tests/test_metadata.py
def test_row_hash_deterministic_column_order():
    import pandas as pd
    from ingestion.metadata import upsert_period_versions
    from ingestion.hashing import row_hash
    
    # Same data, different column orders
    df1 = pd.DataFrame({"period": ["2024-01"], "org_code": ["R1"], "metric_a": [10], "metric_b": [20]})
    df2 = pd.DataFrame({"period": ["2024-01"], "org_code": ["R1"], "metric_b": [20], "metric_a": [10]})
    
    # Hash should be identical regardless of column order
    cols1 = sorted(c for c in df1.columns if c not in EXCLUDED_HASH_COLUMNS)
    cols2 = sorted(c for c in df2.columns if c not in EXCLUDED_HASH_COLUMNS)
    
    hash1 = row_hash(df1.iloc[0][c] for c in cols1)
    hash2 = row_hash(df2.iloc[0][c] for c in cols2)
    
    assert hash1 == hash2
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_metadata.py::test_row_hash_deterministic_column_order -v
# Expected: FAIL — columns not sorted
```

**Step 3: Apply fix**

Change line 66 from `value_cols = [c for c in df.columns ...]` to `value_cols = sorted(c for c in df.columns ...)`

**Step 4: Run test to verify pass**

```bash
pytest tests/test_metadata.py::test_row_hash_deterministic_column_order -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/metadata.py tests/test_metadata.py
git commit -m "fix: sort value columns for deterministic row hashing"
```

---

### Task 7: Batch Upsert for period_version Table

**Objective:** Replace row-by-row upsert (3 round-trips/row) with single bulk operation using CTE.

**Files:**
- Modify: `ingestion/metadata.py:58-93`

**Step 1: Write failing test**

```python
# tests/test_metadata.py
def test_upsert_period_versions_batch_performance(postgres_engine):
    import pandas as pd
    from ingestion.metadata import upsert_period_versions, record_source_file
    
    # Create test data: 100 providers × 3 months = 300 rows
    df = pd.DataFrame({
        "period": ["2024-01"] * 100 + ["2024-02"] * 100 + ["2024-03"] * 100,
        "org_code": [f"R{i:03d}" for i in range(100)] * 3,
        "attendances": list(range(300)),
        "admissions": list(range(300, 600)),
    })
    
    # First insert
    sid = record_source_file(..., status="loaded")
    changed1 = upsert_period_versions(postgres_engine, df, sid)
    assert changed1 == 300
    
    # Second insert (no changes) — should be fast and return 0
    import time
    start = time.time()
    changed2 = upsert_period_versions(postgres_engine, df, sid)
    elapsed = time.time() - start
    
    assert changed2 == 0
    assert elapsed < 1.0  # Should complete in under 1 second
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_metadata.py::test_upsert_period_versions_batch_performance -v
# Expected: FAIL — row-by-row is slow, returns wrong count on re-run
```

**Step 3: Apply fix**

Replace `upsert_period_versions()` with batch CTE version per proposed code.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_metadata.py::test_upsert_period_versions_batch_performance -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/metadata.py tests/test_metadata.py
git commit -m "perf: batch upsert for period_version using CTE"
```

---

### Task 8: Validate data_month Parameter

**Objective:** Add type validation and normalization for `data_month` in `record_source_file()`.

**Files:**
- Modify: `ingestion/metadata.py:32-55`

**Step 1: Write failing test**

```python
# tests/test_metadata.py
def test_normalize_data_month_valid_formats():
    from ingestion.metadata import _normalize_data_month
    from datetime import date, datetime
    
    assert _normalize_data_month("2024-01") == date(2024, 1, 1)
    assert _normalize_data_month(date(2024, 1, 15)) == date(2024, 1, 1)
    assert _normalize_data_month(datetime(2024, 1, 15, 12, 30)) == date(2024, 1, 1)
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_metadata.py::test_normalize_data_month_valid_formats -v
# Expected: FAIL — function doesn't exist
```

**Step 3: Apply fix**

Add `_normalize_data_month()` helper and use it in `record_source_file()`.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_metadata.py::test_normalize_data_month_valid_formats -v
# Expected: PASS
```

**Step 5: Write invalid format test**

```python
def test_normalize_data_month_invalid():
    from ingestion.metadata import _normalize_data_month
    import pytest
    
    with pytest.raises(ValueError):
        _normalize_data_month("2024/01")
    with pytest.raises(ValueError):
        _normalize_data_month("01-2024")
    with pytest.raises(TypeError):
        _normalize_data_month(12345)
```

**Step 6: Run test to verify pass**

```bash
pytest tests/test_metadata.py::test_normalize_data_month_invalid -v
# Expected: PASS
```

**Step 7: Commit**

```bash
git add ingestion/metadata.py tests/test_metadata.py
git commit -m "feat: validate and normalize data_month parameter"
```

---

### Task 9: Add IngestStatus Enum

**Objective:** Replace magic string status values with typed enum.

**Files:**
- Modify: `ingestion/metadata.py` (add enum, update `record_source_file`)

**Step 1: Write failing test**

```python
# tests/test_metadata.py
def test_ingest_status_enum():
    from ingestion.metadata import IngestStatus
    
    assert IngestStatus.LOADED.value == "loaded"
    assert IngestStatus.FAILED.value == "failed"
    assert IngestStatus.SKIPPED_DUPLICATE.value == "skipped_duplicate"
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_metadata.py::test_ingest_status_enum -v
# Expected: FAIL — enum doesn't exist
```

**Step 3: Apply fix**

Add `IngestStatus` enum class and update `record_source_file()` to accept it.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_metadata.py::test_ingest_status_enum -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/metadata.py tests/test_metadata.py
git commit -m "feat: add IngestStatus enum for type-safe status values"
```

---

### Task 10: Structured Logging with Correlation IDs

**Objective:** Add structured logging (`extra=` dict) for observability.

**Files:**
- Modify: `ingestion/metadata.py` (all log calls)
- Modify: `ingestion/link_resolver.py` (all log calls)

**Step 1: Write failing test**

```python
# tests/test_metadata.py
def test_structured_logging_contains_correlation_fields(caplog):
    from ingestion.metadata import upsert_period_versions
    import pandas as pd
    
    df = pd.DataFrame({"period": ["2024-01"], "org_code": ["R1"], "value": [100]})
    upsert_period_versions(engine, df, source_file_id=42)
    
    # Check log record has extra fields
    assert any("source_file_id" in r.__dict__ for r in caplog.records)
    assert any("changed_rows" in r.__dict__ for r in caplog.records)
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_metadata.py::test_structured_logging_contains_correlation_fields -v
# Expected: FAIL — logs don't have extra fields
```

**Step 3: Apply fix**

Update all `log.info/error/warning` calls to include `extra={...}` with relevant correlation fields.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_metadata.py::test_structured_logging_contains_correlation_fields -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/metadata.py ingestion/link_resolver.py tests/test_metadata.py tests/test_link_resolver.py
git commit -m "feat: add structured logging with correlation fields"
```

---

### Task 11: Verify run_id in finish_run

**Objective:** Raise error if `finish_run()` called with non-existent `run_id`.

**Files:**
- Modify: `ingestion/metadata.py:103-112`

**Step 1: Write failing test**

```python
# tests/test_metadata.py
def test_finish_run_raises_on_invalid_run_id(postgres_engine):
    from ingestion.metadata import finish_run
    import pytest
    
    with pytest.raises(ValueError, match="run_id=99999"):
        finish_run(postgres_engine, run_id=99999, status="success")
```

**Step 2: Run test to verify failure**

```bash
pytest tests/test_metadata.py::test_finish_run_raises_on_invalid_run_id -v
# Expected: FAIL — no validation
```

**Step 3: Apply fix**

Check `result.rowcount` after UPDATE and raise if 0.

**Step 4: Run test to verify pass**

```bash
pytest tests/test_metadata.py::test_finish_run_raises_on_invalid_run_id -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add ingestion/metadata.py tests/test_metadata.py
git commit -m "fix: validate run_id exists in finish_run"
```

---

### Task 12: Type Hints and Docstring Polish

**Objective:** Add missing type hints and clean up comments.

**Files:**
- Modify: `ingestion/metadata.py:32` (data_month type)
- Modify: `ingestion/metadata.py:53` (remove "Fixed hyphen to underscore" comment)
- Modify: `ingestion/link_resolver.py` (remove unused `settings` import if applicable)

**Step 1: Apply fixes directly** (no tests needed for type hints)

**Step 2: Run full test suite**

```bash
pytest tests/ -v
# Expected: all pass
```

**Step 3: Commit**

```bash
git add ingestion/metadata.py ingestion/link_resolver.py
git commit -m "style: add type hints and remove stale comments"
```

---

## Test Infrastructure Setup (Prerequisite)

Before Task 1, ensure test infrastructure exists:

```bash
# Create test directories
mkdir -p tests/fixtures

# Create conftest.py with postgres_engine fixture
cat > tests/conftest.py << 'EOF'
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

@pytest.fixture(scope="session")
def postgres_engine():
    # Use test database or SQLite in-memory
    engine = create_engine("postgresql://test:test@localhost:5432/test_db")
    # Run migrations / create tables here
    yield engine
    engine.dispose()

@pytest.fixture
def mock_landing_page():
    with open("tests/fixtures/landing_page.html") as f:
        return f.read()
EOF
```

---

## Verification Checklist

After all tasks complete:

- [ ] All unit tests pass: `pytest tests/ -v`
- [ ] Integration tests pass: `pytest tests/integration/ -v`
- [ ] Performance benchmark shows improvement: `pytest tests/perf/ --benchmark-only`
- [ ] No lint errors: `ruff check ingestion/`
- [ ] Type check passes: `mypy ingestion/`
- [ ] Code review passes (no critical findings remain)

---

## Risks & Trade-offs

| Risk | Mitigation |
|------|------------|
| Batch upsert CTE may lock table longer | Test with production-scale data; consider `LOCK_TIMEOUT` |
| Dynamic year discovery depends on landing page structure | Add fallback to hardcoded list if discovery returns empty |
| robots.txt parsing may fail on unusual configs | Default to allow on parse failure; log warning |
| Column sorting for hash may reorder semantically | Document that hash column order is alphabetical, not semantic |

---

## Open Questions

1. **Settings module location**: Is `ingestion/settings.py` the canonical config? Confirm before Task 2.
2. **Database migration**: Do we need Alembic migration for `IngestStatus` enum (if using PG enum type)?
3. **Test database**: Should integration tests use testcontainers or dedicated test DB?
4. **Backfill CLI**: Is there a backfill command that calls `resolve_backfill_urls()`? Need to verify integration point.

---

## Execution Handoff

**Plan complete and saved.** Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed with Task 1?