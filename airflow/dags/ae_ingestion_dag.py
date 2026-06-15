"""Airflow DAG: monthly NHS A&E ingestion.

Schedule: every Thursday 08:00 (the publication lands on the 2nd Thursday;
running weekly is safe because the pipeline is idempotent — it skips when the
file's bytes are unchanged).

The DAG shares only small strings between tasks (URL, object key, hash) via
XCom; the heavy file lives in MinIO, read back where needed. Parse + load are
combined into one task so we never push a DataFrame through XCom.
"""
from __future__ import annotations

import sys
from datetime import datetime

# The ingestion package is mounted at /opt/airflow/ingestion (docker-compose).
sys.path.insert(0, "/opt/airflow")

from airflow.decorators import dag, task  # noqa: E402


@dag(
    dag_id="ae_ingestion",
    schedule="0 8 * * 4",            # Thursdays 08:00 UTC
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=["nhs", "ae", "ingestion"],
    default_args={"retries": 2},
    doc_md=__doc__,
)
def ae_ingestion():

    @task()
    def resolve_link() -> dict:
        from ingestion import link_resolver
        link = link_resolver.resolve_timeseries_url()
        return {"url": link.url}

    @task()
    def download_to_raw(link: dict) -> dict:
        from ingestion import downloader, metadata, staging_loader, storage
        dl = downloader.download(link["url"])
        engine = staging_loader.get_engine()
        if metadata.already_ingested(engine, "Monthly A&E Time Series", dl.sha256):
            return {"skip": True, "sha256": dl.sha256}
        raw = storage.RawStorage()
        raw.ensure_bucket()
        key = raw.build_key(dl.filename)
        raw.put_file(key, dl.content)
        return {"skip": False, "key": key, "sha256": dl.sha256,
                "filename": dl.filename, "url": dl.source_url}

    @task()
    def parse_and_load(meta: dict) -> dict:
        if meta.get("skip"):
            return {"status": "skipped_no_change", "rows": 0}
        from ingestion import metadata as m
        from ingestion import parser, staging_loader, storage
        from ingestion.schema import load_registry

        registry = load_registry()
        raw = storage.RawStorage()
        content = raw.get_file(meta["key"])
        df, missing = parser.parse(content, registry)
        if missing:
            raise RuntimeError(f"Missing required columns: {missing}")

        rows = staging_loader.load(
            df, source_file_name=meta["filename"],
            source_file_hash=meta["sha256"], source_url=meta["url"],
        )
        engine = staging_loader.get_engine()
        data_month = (df["period"].max().date().isoformat()
                      if df["period"].notna().any() else None)
        sid = m.record_source_file(
            engine, source_name="Monthly A&E Time Series",
            filename=meta["filename"], url=meta["url"], sha256=meta["sha256"],
            size_bytes=len(content), schema_version=registry.schema_version,
            raw_key=meta["key"], row_count=rows, data_month=data_month,
            status="success",
        )
        changed = m.upsert_period_versions(engine, df, sid)
        return {"status": "success", "rows": rows, "changed": changed}

    parse_and_load(download_to_raw(resolve_link()))


ae_ingestion()
