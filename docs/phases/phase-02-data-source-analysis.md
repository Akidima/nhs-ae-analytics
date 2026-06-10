# NHS A&E Demand and Emergency Admissions Analytics Platform
## Phase 2: Data Source Analysis

**Project:** NHS A&E Demand and Emergency Admissions Analytics
**Phase:** 2 of 13
**Deliverables:** Data dictionary, source metadata catalog, revision management strategy
**Prerequisite:** Phase 1 (Healthcare Domain Understanding)
**Next Phase:** Phase 3 — Architecture Design

> **Note on accuracy:** The structural facts in this document (publication schedule, file URLs, naming conventions, ECDS timeline) were verified against the live NHS England publication page. Exact column positions in the XLS should always be re-verified against the live file during implementation, because NHS England occasionally adjusts layout — handling that drift is itself a design requirement (see §9).

---

## 🧒 Explain Like I'm 10

> **Remember our restaurant kitchen.** Phase 1 was "learn what food you're cooking." **Phase 2 is "open the delivery boxes and check what's inside before you cook."**
>
> A food truck pulls up with boxes of ingredients (the NHS hospital data). A good chef never just dumps everything into the pot. First you open each box and look: Is this fresh or rotten? Is the label right? Did they send what I actually ordered?
>
> When we opened the boxes, we found four sneaky problems:
> 1. **The delivery label changes its barcode every single time.** So you can't memorise where the box is kept — you have to look it up fresh on every delivery. *(The download link has a random code in it, so you must scrape the web page each time instead of guessing the address.)*
> 2. **The truck re-delivers the whole month's order every time, and quietly fixes old mistakes.** So you have to notice when an old box has secretly been swapped for a corrected one. *(The file restates all of history every month, so corrections keep arriving.)*
> 3. **Some of the oldest boxes are guesses, not the real thing.** *(Data before June 2015 is estimated, not measured.)*
> 4. **For about four years, 14 shops forgot to send part of their order.** If you don't know that, you'll think those shops sold nothing. *(The "CRS field test" gap — 14 trusts stopped reporting 4-hour performance from 2019 to 2023.)*
>
> If you skipped this checking step, you'd cook with a rotten tomato and only find out when a customer complained. **Phase 2 is the "check the boxes before you cook" step — and we wrote down every trap so the kitchen handles them automatically.**

---

## Table of Contents

1. [The Publication — What We Are Actually Ingesting](#1-the-publication)
2. [The Three Source Files That Matter](#2-the-three-source-files)
3. [File Naming Conventions — The Single Most Important Finding](#3-file-naming-conventions)
4. [Dataset Layout and Sheet Structure](#4-dataset-layout-and-sheet-structure)
5. [Complete Data Dictionary (MSitAE)](#5-complete-data-dictionary)
6. [The ECDS Supplementary Dataset](#6-the-ecds-supplementary-dataset)
7. [Known Data Quality Caveats](#7-known-data-quality-caveats)
8. [Revision Management Strategy](#8-revision-management-strategy)
9. [Schema Drift Detection](#9-schema-drift-detection)
10. [Historical Data Storage Strategy](#10-historical-data-storage-strategy)
11. [Source Metadata Catalog Framework](#11-source-metadata-catalog-framework)
12. [Source-to-Target Mapping](#12-source-to-target-mapping)

---

## 1. The Publication

The dataset we are building on is officially called the **Monthly A&E Attendances and Emergency Admissions** collection — commonly abbreviated **MSitAE** (Monthly Situation Report, A&E).

### Verified Facts About the Publication

| Attribute | Value |
|-----------|-------|
| **Publisher** | NHS England (Operational Insights — UEC team, Leeds) |
| **Release schedule** | 2nd Thursday of every month |
| **Reporting lag** | Publication covers the *previous* month (e.g., the August release contains July data) |
| **Reporting unit** | Provider organisation — NHS Trusts, NHS Foundation Trusts, **and Independent Sector Organisations** |
| **Format** | Excel `.xls` (legacy binary format, not `.xlsx`) |
| **Licence** | Open Government Licence v3.0 (free to reuse with attribution) |
| **Contact** | england.aedata@nhs.net |
| **Authoritative definitions** | "A&E Attendances and Emergency Admissions Monthly Return Definitions v5.0 (August 2020)" |

### Two Critical Domain Facts From This Page

1. **Independent Sector Organisations are included.** This means our `dim_provider` must handle non-NHS providers, not only NHS Trusts. Some organisation codes will not map to an ICB in the standard NHS ODS hierarchy. Plan for nulls in the ICB join.

2. **The publication is organised by NHS financial year**, not calendar year. Monthly pages exist for 2025-26, 2024-25, 2023-24, and so on back to 2015-16. Each financial-year page lists that year's monthly releases. This confirms the `dim_month` financial-year design from Phase 1.

### Publication URL (the page we scrape)

```
https://www.england.nhs.uk/statistics/statistical-work-areas/ae-waiting-times-and-activity/
```

---

## 2. The Three Source Files

The landing page exposes three downloadable files that matter for this project. Understanding the difference between them dictates the entire ingestion strategy.

### File A — Monthly A&E Time Series (PRIMARY SOURCE)

```
Label on page: "Monthly A&E Time Series February 2026 (XLS, 432KB)"
Example URL:    .../sites/2/2026/03/Monthly-AE-Time-Series-February-2026-D36ah6.xls
```

This is the **master file** and the backbone of our platform. It is a single XLS containing **every month from June 2015 to the latest reporting month**, refreshed and re-published every month.

**Why this is the primary source:**
- One download = the entire history
- Consistent column layout across all months
- Every monthly refresh also re-states historical months, so **revisions to old months arrive automatically** inside this file

**Implication:** We do not need to hoard individual monthly files for the historical record. We ingest this one file each month, and it gives us both the new month and any revisions to prior months.

### File B — Quarterly Annual Time Series (SECONDARY / RECONCILIATION)

```
Label: "Quarterly Annual Time Series (XLS, 176KB)"
Example URL: .../sites/2/2026/02/Quarterly-Annual-Time-Series-Revised-20260210-v5dd3g.xls
```

Quarterly and annual aggregates back to 2011-12. We use this for **reconciliation** — our quarterly roll-ups computed from monthly data should match the official quarterly figures. It is not the primary load source.

### File C — Supplementary ECDS Analysis Time Series (V2 ENHANCEMENT)

```
Label: "Supplementary ECDS Analysis Time Series February 2023 Onwards (XLSX, 55KB)"
Example URL: .../sites/2/2026/03/Supplementary-ECDS-Analysis-Time-Series-...-1.xlsx
```

This is the richer ECDS-derived dataset (12-hour-from-arrival performance, demographic breakdowns, frailty). It is **not** part of V1. It is the foundation of the Phase 12 / V2 enhancement. Note it is `.xlsx` (modern format) whereas the primary file is `.xls`.

### Ingestion Strategy Decision

```
INITIAL LOAD (one-time):
    Download File A (Monthly Time Series)
        → contains full history June 2015 → present
        → load everything

MONTHLY REFRESH (recurring, 2nd Thursday + buffer):
    Download File A again
        → contains the new month + any revised historical months
        → detect changes via hashing (see §8)
        → reload changed periods only

QUARTERLY RECONCILIATION:
    Download File B
        → validate our quarterly aggregates match official figures

V2 (future):
    Add File C (ECDS) ingestion as a parallel pipeline
```

---

## 3. File Naming Conventions

This is the **single most important engineering finding** of Phase 2, and it determines how the ingestion layer must be built.

### The Naming Pattern

```
Monthly-AE-Time-Series-February-2026-D36ah6.xls
└────────┬───────────┘ └──┬──┘ └─┬─┘ └─┬──┘ └┬┘
      fixed prefix      month   year  RANDOM  ext
                                      SUFFIX
```

And the URL path embeds the **publication** year/month (not the data month):

```
https://www.england.nhs.uk/statistics/wp-content/uploads/sites/2/2026/03/
                                                                  └─┬─┘└┬┘
                                                          publication year/month
                                                          (March 2026 release
                                                           = February 2026 data)
```

### Why This Breaks Naive Automation

The suffix `D36ah6` is a **random WordPress media token**. It is:
- Unpredictable — you cannot construct next month's URL in advance
- Not derivable from the date
- Different for every file and every revision

**Therefore: you cannot hardcode or template the download URL.** Any tutorial that tells you to build the URL from the date will break on the first run.

### The Correct Approach — Scrape, Then Download

```
1. HTTP GET the landing page HTML
2. Parse the HTML for the anchor whose link text matches:
       "Monthly A&E Time Series"
3. Extract the href (the full URL including random suffix)
4. Download that exact URL
5. Record the resolved URL in metadata (it is itself a revision signal —
   when the URL changes, the file has been re-published)
```

This is why our Phase 5 ingestion framework includes an **HTML link-resolution step** before any download. We will build a small resilient parser that:
- Locates the link by visible text pattern, not by URL
- Tolerates whitespace/case variations in the link text
- Fails loudly (alerts) if no matching link is found (the page layout may have changed)

### Reference Implementation Sketch (full version in Phase 5)

```python
import re
import requests
from bs4 import BeautifulSoup

LANDING_PAGE = (
    "https://www.england.nhs.uk/statistics/statistical-work-areas/"
    "ae-waiting-times-and-activity/"
)

def resolve_timeseries_url(landing_html: str) -> str:
    """Find the 'Monthly A&E Time Series' download link by its visible text.

    We never construct the URL — the random WordPress suffix makes that
    impossible. We resolve it from the rendered page every run.
    """
    soup = BeautifulSoup(landing_html, "html.parser")
    pattern = re.compile(r"monthly\s+a&e\s+time\s+series", re.IGNORECASE)

    for anchor in soup.find_all("a", href=True):
        text = anchor.get_text(strip=True)
        if pattern.search(text):
            return anchor["href"]

    raise RuntimeError(
        "Could not locate the Monthly A&E Time Series link. "
        "The NHS England page layout may have changed — manual review required."
    )
```

---

## 4. Dataset Layout and Sheet Structure

The Monthly Time Series `.xls` is a multi-sheet workbook. The exact sheet names vary slightly over time, but the structure is consistent.

### Typical Workbook Structure

```
Monthly-AE-Time-Series-[Month]-[Year].xls
│
├── Sheet: "Cover" / "Notes"
│     Publication metadata, definitions, caveats, contact details
│
├── Sheet: "Activity"  (or similar — the PRIMARY data sheet)
│     One row per provider per month
│     ~200+ providers × ~120+ months = the core fact data
│     This is what we load.
│
├── Sheet: "Performance"
│     4-hour performance percentages (sometimes combined with Activity)
│
└── Sheet: "National" / aggregate rows
      National totals used for reconciliation
```

### The Header Complication

NHS England Excel files are designed for **human reading**, not machine parsing. Expect:

| Complication | What It Looks Like | How We Handle It |
|--------------|--------------------|--------------------|
| Multi-row headers | Column titles span 2–3 merged rows | Skip N rows; build a flattened header map |
| Merged cells | A header cell spans several columns | Forward-fill merged values during parse |
| Title/logo rows | First several rows are branding, not data | Detect the true header row dynamically |
| Footnote rows | Asterisks and notes appended below the data | Stop reading at first all-null row |
| Blank spacer columns | Empty columns for visual separation | Drop fully-null columns |
| Number formatting | Percentages stored as text or as 0–1 floats | Normalise to numeric percentage 0–100 |
| Period as text | "Jun-15", "June 2015", or a date serial | Parse robustly into a real date |

**Engineering principle:** Never assume a fixed row offset. Detect the header row by searching for a known anchor column name (e.g., a cell containing "Code" or "Org Code"). This makes ingestion resilient to NHS England adding or removing branding rows.

---

## 5. Complete Data Dictionary

This is the canonical column set of the Monthly Time Series **Activity** sheet (the MSitAE return). Column *labels* in the file are verbose and human-formatted; the table below maps each source concept to the clean field name we will use in staging.

> Verify exact source labels against the live file at implementation time. The *concepts* below are stable; the *exact wording* drifts.

### Identity / Dimension Columns

| # | Source Concept | Staging Field | Type | Description |
|---|----------------|---------------|------|-------------|
| 1 | Period | `period` | DATE | The reporting month (normalised to first-of-month) |
| 2 | Org Code | `org_code` | TEXT | ODS code of the provider (PK component) |
| 3 | Parent Org Code | `parent_org_code` | TEXT | Region/parent grouping (where present) |
| 4 | Org Name | `org_name` | TEXT | Provider name |

### Attendance Measures

| # | Source Concept | Staging Field | Type | Description |
|---|----------------|---------------|------|-------------|
| 5 | A&E attendances Type 1 | `attendances_type1` | INTEGER | Major dept attendances |
| 6 | A&E attendances Type 2 | `attendances_type2` | INTEGER | Single-specialty attendances |
| 7 | A&E attendances Other (Type 3) | `attendances_type3` | INTEGER | MIU / UTC / walk-in attendances |
| 8 | A&E attendances Total | `attendances_total` | INTEGER | Sum of types (reported, used to reconcile) |

### 4-Hour Breach Measures

| # | Source Concept | Staging Field | Type | Description |
|---|----------------|---------------|------|-------------|
| 9 | Attendances > 4 hrs Type 1 | `breaches_type1` | INTEGER | Type 1 attendances over 4 hours |
| 10 | Attendances > 4 hrs Type 2 | `breaches_type2` | INTEGER | Type 2 over 4 hours |
| 11 | Attendances > 4 hrs Other | `breaches_type3` | INTEGER | Type 3 over 4 hours |
| 12 | Attendances > 4 hrs Total | `breaches_total` | INTEGER | All-type breaches |

### Performance Measures (derived in source, recomputed by us)

| # | Source Concept | Staging Field | Type | Description |
|---|----------------|---------------|------|-------------|
| 13 | % in 4 hours or less (Type 1) | `performance_type1_pct` | NUMERIC | Type 1 4-hour performance |
| 14 | % in 4 hours or less (All) | `performance_all_pct` | NUMERIC | All-type 4-hour performance |

> **Design decision:** We **store the source percentages** but **recompute our own** from raw counts in the warehouse. This protects against source rounding and lets us reconcile (see Phase 7). Percentages are normalised to a 0–100 scale regardless of how the source stores them.

### Emergency Admission Measures

| # | Source Concept | Staging Field | Type | Description |
|---|----------------|---------------|------|-------------|
| 15 | Emergency Admissions via Type 1 | `emergency_admissions_type1` | INTEGER | Admissions through major A&E |
| 16 | Emergency Admissions via Type 2 | `emergency_admissions_type2` | INTEGER | Admissions through specialty A&E |
| 17 | Emergency Admissions via Type 3/4 | `emergency_admissions_type3` | INTEGER | Admissions through MIU/UTC |
| 18 | Total Emergency Admissions via A&E | `emergency_admissions_via_ae` | INTEGER | Sum of A&E-routed admissions |
| 19 | Other Emergency Admissions (not via A&E) | `emergency_admissions_other` | INTEGER | GP/direct/consultant route |
| 20 | Total Emergency Admissions | `emergency_admissions_total` | INTEGER | All emergency admissions |

### Long-Wait Measures (post-decision-to-admit)

| # | Source Concept | Staging Field | Type | Description |
|---|----------------|---------------|------|-------------|
| 21 | > 4 hrs from decision to admit | `dta_breaches_4hr` | INTEGER | Patients waiting 4hr+ after DTA |
| 22 | > 12 hrs from decision to admit | `dta_breaches_12hr` | INTEGER | Patients waiting 12hr+ after DTA (key safety metric) |

### Audit Columns (added by us, not in source)

| Staging Field | Type | Description |
|---------------|------|-------------|
| `source_file_name` | TEXT | Original XLS filename including suffix |
| `source_file_hash` | TEXT | SHA-256 of the source file |
| `source_url` | TEXT | Resolved download URL |
| `publication_date` | DATE | Date the file was published |
| `ingested_at` | TIMESTAMP | When our pipeline loaded the row |
| `row_hash` | TEXT | Hash of the row's business values (for revision detection) |
| `is_current` | BOOLEAN | SCD flag — is this the active version of this period+provider? |

---

## 6. The ECDS Supplementary Dataset

This is documented now for completeness and to scope V2 (Phase 12). **It is not loaded in V1.**

### What ECDS Adds

| Feature | Available From | Notes |
|---------|----------------|-------|
| 12-hours-from-arrival performance | April 2023 | The true patient-safety metric (distinct from 12hr DTA) |
| Demographic breakdowns | April 2023 | Age, gender, ethnic category |
| Chief complaint | April 2023 | Presenting clinical reason (Type 1) |
| Type 2 + UTC coverage | November 2023 | Extended beyond Type 1 |
| Frailty (Rockwood CFS) | December 2024 | Frailty scoring for 65+ at the front door |
| Site-level data + new measures | November 2025 | Below-trust granularity; admitted/non-admitted splits; under-16 performance |

### Critical Caveat (NHS England's own words, paraphrased)

ECDS data remains **experimental**, and its coverage differs from the monthly MSitAE publication. The MSitAE collection (File A) **remains the official source of A&E reporting**. So V1 is built on the official source; ECDS is an enrichment layer, never a replacement.

---

## 7. Known Data Quality Caveats

These are real, documented discontinuities in the timeseries. Each must be handled in the warehouse and surfaced to dashboard users so they do not misread the data.

### Caveat 1 — Pre-June 2015 Data Is Estimated

The monthly timeseries before June 2015 is **derived from a previous weekly collection** by apportioning weekly totals across calendar months. These are estimates, not actuals.

**Handling:** Add a `data_basis` attribute to `dim_month`: `'actual'` for June 2015 onward, `'estimated'` before. Dashboards filter to actuals by default, with an option to show estimated history.

### Caveat 2 — Clinical Review of Standards (CRS) Field Test, May 2019 – May 2023

Fourteen NHS Trusts participated in field testing of new UEC metrics and **stopped reporting 4-hour performance** during this period. Their 4-hour data is missing or non-comparable for ~4 years.

**Handling:**
- Maintain a reference list of the 14 CRS trusts with their field-test date ranges
- Flag affected rows with `is_crs_field_test = true`
- Exclude them from national 4-hour performance aggregates for the affected period (or the national figure will be artificially distorted)
- This is a textbook interview talking point — see Phase 12 interview prep

### Caveat 3 — COVID-19 Distortion (2020–2021)

Attendances collapsed during lockdowns then rebounded. Year-on-year comparisons spanning 2020–21 are misleading.

**Handling:** A `covid_period_flag` on `dim_month`; surfaced as a dashboard annotation rather than silently dropped.

### Caveat 4 — Provider Code Changes Over Time

As covered in Phase 1, trust mergers/splits change ODS codes. Across a 10-year timeseries there are dozens of these.

**Handling:** SCD Type 2 in `dim_provider` plus an organisation-bridge reference table (built in Phase 6).

---

## 8. Revision Management Strategy

Because the Monthly Time Series file re-states all history every month, revisions are constant and must be detected automatically.

### Levels of Change Detection

```
LEVEL 1 — FILE LEVEL
   Has the published file changed at all?
   → Compare SHA-256 of the downloaded file vs the last stored hash.
   → Also compare the resolved URL (a new random suffix often signals a re-publish).
   → If identical: skip ingestion entirely (idempotent, cheap).

LEVEL 2 — PERIOD LEVEL
   Which months inside the file changed?
   → For each (period, provider) row, compute a row_hash of business values.
   → Compare against the row_hash already stored for that period+provider.
   → Only reprocess periods where at least one row_hash differs.

LEVEL 3 — ROW LEVEL (SCD)
   A specific provider's specific month was revised.
   → Expire the old version (is_current = false, valid_to = now).
   → Insert the revised version (is_current = true, valid_from = now).
   → Full history of what the data said and when is preserved.
```

### Why Keep Old Versions?

Auditability. If a dashboard showed 71% last month and 73% this month for the same historical period, an analyst must be able to answer "did performance change, or did the *data* change?" The SCD history answers that definitively. This is a governance requirement (Phase 11), not a nice-to-have.

### Revision Workflow

```
                    ┌──────────────────────┐
                    │  Scrape landing page  │
                    └───────────┬───────────┘
                                ▼
                    ┌──────────────────────┐
                    │ Resolve timeseries URL│
                    └───────────┬───────────┘
                                ▼
                    ┌──────────────────────┐
                    │  Download file        │
                    │  Compute file hash    │
                    └───────────┬───────────┘
                                ▼
                    ┌──────────────────────┐
              ┌─────│  File hash changed?   │─────┐
          NO  │     └──────────────────────┘     │ YES
              ▼                                    ▼
     ┌────────────────┐              ┌────────────────────────┐
     │ Log "no change"│              │ Parse → row-level hash  │
     │ End run        │              │ Diff vs warehouse       │
     └────────────────┘              └───────────┬─────────────┘
                                                  ▼
                                     ┌────────────────────────┐
                                     │ For each changed period:│
                                     │  expire old SCD rows     │
                                     │  insert revised rows     │
                                     │  re-run validation       │
                                     └────────────────────────┘
```

---

## 9. Schema Drift Detection

NHS England adjusts the XLS layout over time (new columns for DTA waits, renamed headers, the ECDS additions). Silent drift is dangerous: data can load into the wrong column and pass naive checks.

### The Schema Registry

We maintain a versioned **expected schema** as a YAML file in the repo. Every ingestion run validates the parsed header against it before loading a single row.

```yaml
# config/schema_registry/msitae_activity.yml
schema_version: "2024.01"
source: "Monthly A&E Time Series"
sheet_anchor_column: "Code"          # used to locate the true header row
expected_columns:
  - source_label_contains: "Period"
    maps_to: period
    required: true
  - source_label_contains: "Code"
    maps_to: org_code
    required: true
  - source_label_contains: "Name"
    maps_to: org_name
    required: true
  - source_label_contains: "Type 1"          # within attendances block
    maps_to: attendances_type1
    required: true
  # ... full mapping continues
drift_policy:
  on_missing_required_column: halt_and_alert
  on_unexpected_new_column:   warn_and_continue   # capture into _unmapped JSON
  on_renamed_column:          fuzzy_match_then_alert
```

### Drift Handling Rules

| Drift Type | Action |
|------------|--------|
| A required column disappears | **Halt** the run, alert humans — do not load |
| A new unexpected column appears | **Warn**, capture raw into an `_unmapped` JSONB column, continue |
| A column is renamed (fuzzy match ≥ threshold) | Map it, but **alert** so the registry can be updated deliberately |
| Header row moved (extra branding rows) | Auto-handled by anchor-column detection — no alert |

This converts a class of silent data-corruption failures into loud, actionable alerts.

---

## 10. Historical Data Storage Strategy

### The Raw Zone — Immutable Archive

Every downloaded file is stored, unmodified, forever. This is the immutable raw zone (S3/Azure Blob in cloud; a mounted volume locally).

```
raw/
└── msitae/
    └── ingest_date=2026-03-12/                 # date we downloaded it
        ├── Monthly-AE-Time-Series-February-2026-D36ah6.xls
        └── _manifest.json                       # metadata sidecar
```

### Manifest Sidecar (`_manifest.json`)

```json
{
  "source": "Monthly A&E Time Series",
  "source_url": "https://www.england.nhs.uk/.../Monthly-AE-Time-Series-February-2026-D36ah6.xls",
  "original_filename": "Monthly-AE-Time-Series-February-2026-D36ah6.xls",
  "data_month": "2026-02-01",
  "publication_date": "2026-03-12",
  "ingest_timestamp": "2026-03-12T07:14:02Z",
  "file_size_bytes": 442368,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb924...",
  "schema_version_detected": "2024.01",
  "row_count_parsed": 24180
}
```

### Why Immutable Raw Storage Matters

| Benefit | Explanation |
|---------|-------------|
| **Reproducibility** | Any warehouse state can be rebuilt from raw files alone |
| **Audit** | Prove exactly what the source said on any past date |
| **Revision forensics** | Compare an old raw file vs a revised one byte-for-byte |
| **Backfill safety** | A bad transformation can be re-run without re-downloading |
| **Compliance** | Demonstrates data lineage for governance review |

### Retention Policy

| Zone | Retention | Rationale |
|------|-----------|-----------|
| Raw files | Indefinite | Cheap; the source of truth; small files |
| Staging tables | 90 days (rolling) | Reprocessable from raw |
| Warehouse (marts) | Indefinite + SCD history | The analytical product |
| Logs | 1 year | Operational troubleshooting |

### Partitioning

Raw is partitioned by `ingest_date`. Staging/warehouse fact data is partitioned by `period` (reporting month) for query pruning — most dashboards filter by date range, so date partitioning is the highest-value choice.

---

## 11. Source Metadata Catalog Framework

The metadata catalog is a set of tables in PostgreSQL that record everything about every file we ingest. It is the operational backbone for revision detection, lineage, and reconciliation.

```sql
-- =====================================================================
-- METADATA CATALOG  (schema: meta)
-- =====================================================================

-- One row per physical file we have ever downloaded
CREATE TABLE meta.source_file (
    source_file_id      BIGSERIAL PRIMARY KEY,
    source_name         TEXT        NOT NULL,   -- 'Monthly A&E Time Series'
    original_filename   TEXT        NOT NULL,
    resolved_url        TEXT        NOT NULL,
    data_month          DATE,                   -- latest data month in file
    publication_date    DATE,
    file_size_bytes     BIGINT,
    sha256              TEXT        NOT NULL,
    schema_version      TEXT,
    raw_storage_path    TEXT        NOT NULL,
    row_count_parsed    INTEGER,
    ingest_status       TEXT        NOT NULL,   -- 'success','failed','skipped_no_change'
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_name, sha256)                -- never ingest same bytes twice
);

-- One row per (period, provider) version we have observed — revision history
CREATE TABLE meta.period_version (
    period_version_id   BIGSERIAL PRIMARY KEY,
    source_file_id      BIGINT REFERENCES meta.source_file(source_file_id),
    period              DATE        NOT NULL,
    org_code            TEXT        NOT NULL,
    row_hash            TEXT        NOT NULL,    -- hash of business values
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,             -- NULL = current version
    is_current          BOOLEAN     NOT NULL DEFAULT true
);
CREATE INDEX ix_period_version_lookup
    ON meta.period_version (period, org_code, is_current);

-- Schema drift log — every drift event for audit + alerting
CREATE TABLE meta.schema_drift_log (
    drift_id            BIGSERIAL PRIMARY KEY,
    source_file_id      BIGINT REFERENCES meta.source_file(source_file_id),
    drift_type          TEXT NOT NULL,          -- 'missing_required','new_column','renamed'
    column_detail       TEXT,
    action_taken        TEXT,                   -- 'halted','warned','fuzzy_mapped'
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reconciliation results — our totals vs published national totals
CREATE TABLE meta.reconciliation_result (
    reconciliation_id   BIGSERIAL PRIMARY KEY,
    period              DATE NOT NULL,
    metric_name         TEXT NOT NULL,          -- 'total_attendances', etc.
    our_value           NUMERIC,
    published_value     NUMERIC,
    variance            NUMERIC,
    status              TEXT NOT NULL,          -- 'pass','fail'
    checked_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This catalog is what makes the platform *operable* rather than just a script that loads a spreadsheet.

---

## 12. Source-to-Target Mapping

The end-to-end map from spreadsheet to warehouse, which drives the dbt models in Phase 8.

```
SOURCE (XLS Activity sheet)          STAGING (stg_msitae_activity)        WAREHOUSE
─────────────────────────────        ───────────────────────────         ────────────────────
Period                          ───► period (DATE)                  ───► dim_month.month_key
Org Code                        ───► org_code (TEXT)                ───► dim_provider.provider_key
Org Name                        ───► org_name (TEXT)                ───► dim_provider (SCD2 attr)
[derived ICB from ODS lookup]   ───► icb_code (TEXT, joined)        ───► dim_provider (SCD2 attr)

A&E attendances Type 1          ───► attendances_type1             ───► fact_ae_activity (measure)
A&E attendances Type 2          ───► attendances_type2             ───► fact_ae_activity (measure)
A&E attendances Other           ───► attendances_type3             ───► fact_ae_activity (measure)
A&E attendances Total           ───► attendances_total (reconcile) ───► (reconciliation only)

> 4 hrs Type 1                  ───► breaches_type1                ───► fact_ae_activity (measure)
> 4 hrs Type 2                  ───► breaches_type2                ───► fact_ae_activity (measure)
> 4 hrs Other                   ───► breaches_type3                ───► fact_ae_activity (measure)
> 4 hrs Total                   ───► breaches_total (reconcile)    ───► (reconciliation only)

Em. Admissions via Type 1       ───► emergency_admissions_type1    ───► fact_ae_activity (measure)
Em. Admissions via Type 2       ───► emergency_admissions_type2    ───► fact_ae_activity (measure)
Em. Admissions via Type 3/4     ───► emergency_admissions_type3    ───► fact_ae_activity (measure)
Total Em. Admissions via A&E    ───► emergency_admissions_via_ae   ───► fact_ae_activity (measure)
Other Em. Admissions            ───► emergency_admissions_other    ───► fact_ae_activity (measure)
Total Em. Admissions            ───► emergency_admissions_total    ───► fact_ae_activity (measure)

> 4 hrs from DTA                ───► dta_breaches_4hr              ───► fact_ae_activity (measure)
> 12 hrs from DTA               ───► dta_breaches_12hr            ───► fact_ae_activity (measure)

% in 4 hrs (Type 1)             ───► performance_type1_pct (kept) ───► (reconcile vs recomputed)
% in 4 hrs (All)                ───► performance_all_pct (kept)   ───► (reconcile vs recomputed)
```

Performance percentages in `fact_ae_activity` are **recomputed** from counts in the dbt mart layer, never trusted from the source — the source values are retained purely to validate our recomputation.

---

## Phase 2 Complete

### Deliverables Produced

| Deliverable | Location in This Document |
|-------------|---------------------------|
| Data dictionary | §5 (MSitAE) + §6 (ECDS scope) |
| Source metadata catalog | §11 (full DDL framework) |
| Revision management strategy | §8 (three-level detection + workflow) |
| Bonus: schema registry | §9 |
| Bonus: storage/retention strategy | §10 |
| Bonus: source-to-target map | §12 |

### Key Decisions Locked In

1. **Primary source = Monthly A&E Time Series file** (full history, auto-revising).
2. **URLs must be scraped, never constructed** (random WordPress suffix).
3. **Recompute performance from counts**; keep source % only to reconcile.
4. **Three-level change detection** (file hash → row hash → SCD).
5. **Immutable raw zone** with manifest sidecars; indefinite retention.
6. **Schema registry** guards against silent drift.
7. **Known caveats** (pre-2015 estimates, CRS field test, COVID, code changes) tracked as dimension attributes/flags.

### What to Learn Before Phase 3

| Topic | Why |
|-------|-----|
| `pandas` + `xlrd` for `.xls` parsing | The source is legacy binary Excel — `.xls` needs `xlrd`, not `openpyxl` |
| `BeautifulSoup` HTML parsing | For the link-resolution step |
| SHA-256 hashing in Python (`hashlib`) | For file/row change detection |
| Star schema fundamentals | Phase 3 architecture references the dimensional model heavily |

### Phase 3 Preview

Phase 3 — Architecture Design: the full end-to-end architecture with justification for every technology choice (purpose, benefits, risks, alternatives, cost, scalability), the layered data flow (raw → staging → warehouse → BI), and the orchestration/validation/CI overlay (Airflow, Great Expectations, GitHub Actions).

---

*Document: Phase 2 of 13 | NHS A&E Analytics Platform | Version 1.0*
