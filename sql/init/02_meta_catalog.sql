-- =====================================================================
-- METADATA CATALOG  (schema: meta)  — see Phase 2 §11
-- Operational backbone: revision detection, lineage, reconciliation.
-- =====================================================================

-- One row per physical file we have ever downloaded ------------------
CREATE TABLE IF NOT EXISTS meta.source_file (
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
    UNIQUE (source_name, sha256)                -- never ingest identical bytes twice
);

-- One row per (period, provider) version observed — revision history -
CREATE TABLE IF NOT EXISTS meta.period_version (
    period_version_id   BIGSERIAL PRIMARY KEY,
    source_file_id      BIGINT REFERENCES meta.source_file(source_file_id),
    period              DATE        NOT NULL,
    org_code            TEXT        NOT NULL,
    row_hash            TEXT        NOT NULL,    -- hash of business values
    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,             -- NULL = current version
    is_current          BOOLEAN     NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ix_period_version_lookup
    ON meta.period_version (period, org_code, is_current);

-- Schema drift events ------------------------------------------------
CREATE TABLE IF NOT EXISTS meta.schema_drift_log (
    drift_id            BIGSERIAL PRIMARY KEY,
    source_file_id      BIGINT REFERENCES meta.source_file(source_file_id),
    drift_type          TEXT NOT NULL,          -- 'missing_required','new_column','renamed'
    column_detail       TEXT,
    action_taken        TEXT,                   -- 'halted','warned','fuzzy_mapped'
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reconciliation: our totals vs published national totals ------------
CREATE TABLE IF NOT EXISTS meta.reconciliation_result (
    reconciliation_id   BIGSERIAL PRIMARY KEY,
    period              DATE NOT NULL,
    metric_name         TEXT NOT NULL,          -- 'total_attendances', etc.
    our_value           NUMERIC,
    published_value     NUMERIC,
    variance            NUMERIC,
    status              TEXT NOT NULL,          -- 'pass','fail'
    checked_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pipeline run audit -------------------------------------------------
CREATE TABLE IF NOT EXISTS meta.pipeline_run (
    run_id              BIGSERIAL PRIMARY KEY,
    dag_run_id          TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    status              TEXT,                   -- 'running','success','failed'
    rows_loaded         INTEGER,
    notes               TEXT
);
