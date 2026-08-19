-- =====================================================================
-- METADATA CATALOG
-- Operational backbone for ingestion, revision detection,
-- schema-drift monitoring, reconciliation, lineage, and audit.
-- =====================================================================

CREATE TABLE IF NOT EXISTS meta.source_file (
    source_file_id      BIGSERIAL PRIMARY KEY,
    source_name         TEXT        NOT NULL,
    original_filename   TEXT        NOT NULL,
    resolved_url        TEXT        NOT NULL,
    data_month          DATE,
    publication_date    DATE,
    file_size_bytes     BIGINT,
    sha256              TEXT        NOT NULL
                        CHECK (sha256 ~ '^[0-9a-fA-F]{64}$'),
    schema_version      TEXT,
    raw_storage_path    TEXT        NOT NULL,
    row_count_parsed    INTEGER,
    ingest_status       TEXT        NOT NULL
                        CHECK (
                            ingest_status IN (
                                'success',
                                'failed',
                                'skipped_no_change'
                            )
                        ),
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (source_name, sha256)
);


-- One row per observed version of a (period, provider) record.
CREATE TABLE IF NOT EXISTS meta.period_version (
    period_version_id   BIGSERIAL PRIMARY KEY,

    source_file_id      BIGINT      NOT NULL
                        REFERENCES meta.source_file(source_file_id),

    period              DATE        NOT NULL,
    org_code            TEXT        NOT NULL,

    row_hash            TEXT        NOT NULL
                        CHECK (row_hash ~ '^[0-9a-fA-F]{64}$'),

    valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,

    is_current          BOOLEAN     NOT NULL DEFAULT true,

    CHECK (valid_to IS NULL OR valid_to > valid_from)
);


CREATE INDEX IF NOT EXISTS ix_period_version_lookup
    ON meta.period_version (period, org_code, is_current);


-- Exactly one current version per (period, org_code).
CREATE UNIQUE INDEX IF NOT EXISTS ux_period_version_current
    ON meta.period_version (period, org_code)
    WHERE is_current = true;


-- Schema drift events.
CREATE TABLE IF NOT EXISTS meta.schema_drift_log (
    drift_id            BIGSERIAL PRIMARY KEY,

    source_file_id      BIGINT
                        REFERENCES meta.source_file(source_file_id),

    drift_type          TEXT NOT NULL
                        CHECK (
                            drift_type IN (
                                'missing_required',
                                'new_column',
                                'renamed'
                            )
                        ),

    column_detail       TEXT,

    action_taken        TEXT
                        CHECK (
                            action_taken IN (
                                'halted',
                                'warned',
                                'fuzzy_mapped'
                            )
                        ),

    detected_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Reconciliation between our warehouse and published totals.
CREATE TABLE IF NOT EXISTS meta.reconciliation_result (
    reconciliation_id   BIGSERIAL PRIMARY KEY,

    period              DATE        NOT NULL,
    metric_name         TEXT        NOT NULL,

    our_value           NUMERIC,
    published_value     NUMERIC,
    variance            NUMERIC,

    status              TEXT        NOT NULL
                        CHECK (status IN ('pass', 'fail')),

    checked_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Pipeline execution audit.
CREATE TABLE IF NOT EXISTS meta.pipeline_run (
    run_id              BIGSERIAL PRIMARY KEY,

    dag_run_id          TEXT,

    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,

    status              TEXT        NOT NULL DEFAULT 'running'
                        CHECK (
                            status IN (
                                'running',
                                'success',
                                'failed'
                            )
                        ),

    rows_loaded         INTEGER,
    notes               TEXT,

    CHECK (finished_at IS NULL OR finished_at >= started_at)
);