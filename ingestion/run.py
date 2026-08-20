"""End-to-end ingestion orchestrator and CLI.

    python -m ingestion.run            # full run: resolve→download→store→parse→load
    python -m ingestion.run --inspect  # download + print workbook structure (no DB)
    python -m ingestion.run --dry-run  # resolve→download→parse, but DO NOT load

The full run is idempotent: if the published file's bytes are unchanged since
the last load, it skips (Level-1 detection).
"""
from __future__ import annotations

import argparse
import re
import sys

from . import downloader, link_resolver, metadata, parser, staging_loader, storage
from .logging_setup import get_logger
from .schema import load_registry

log = get_logger("ingestion.run")

SOURCE_NAME = "Monthly A&E Time Series"


def run_ingestion(dag_run_id: str | None = None, dry_run: bool = False,
                  local_file: str | None = None, downloaded=None) -> dict:
    registry = load_registry()
    engine = staging_loader.get_engine()
    run_id = metadata.start_run(engine, dag_run_id) if not dry_run else -1

    try:
        if downloaded is not None:
            dl = downloaded
        elif local_file:
            dl = downloader.load_local(local_file)
        else:
            link = link_resolver.resolve_timeseries_url()
            dl = downloader.download(link.url)

        # 3. Level-1 change detection — skip if identical bytes already loaded
        if not dry_run and metadata.already_ingested(engine, SOURCE_NAME, dl.sha256):
            log.info("File unchanged since last load (sha256 match) — skipping.")
            metadata.finish_run(engine, run_id, status="success",
                                 rows_loaded=0, notes="skipped_no_change")
            return {"status": "skipped_no_change", "rows": 0}

        # 4. parse to tidy DataFrame
        df, missing = parser.parse(dl.content, registry)
        if missing:
            raise RuntimeError(f"Missing required columns: {missing}")

        # 4b. inject period from the metadata block (not present in the grid)
        period = parser.extract_period(dl.content, registry)
        if period is None:
            raise RuntimeError(
                "Could not extract period from metadata block — check 'Period:' label"
            )
        df["period"] = period
        log.info("Injected period=%s onto %d rows", period.date().isoformat(), len(df))

        data_month = (df["period"].max().date().isoformat()
                      if "period" in df.columns and df["period"].notna().any()
                      else None)

        if dry_run:
            log.info("DRY RUN — parsed %d rows, latest month=%s, NOT loading.",
                     len(df), data_month)
            return {"status": "dry_run", "rows": len(df), "data_month": data_month}

        # 5. store immutable raw copy + manifest in MinIO
        raw = storage.RawStorage()
        raw.ensure_bucket()
        key = raw.build_key(dl.filename)
        raw.put_file(key, dl.content)
        manifest = storage.build_manifest(
            source_name=SOURCE_NAME, source_url=dl.source_url,
            filename=dl.filename, sha256=dl.sha256, size_bytes=len(dl.content),
            raw_key=key, schema_version=registry.schema_version,
            data_month=data_month, row_count=len(df),
        )
        raw.write_manifest(key, manifest)

        # 6. load staging (idempotent replace)
        rows = staging_loader.load(
            df, source_file_name=dl.filename, source_file_hash=dl.sha256,
            source_url=dl.source_url,
        )

        # 7. metadata catalog: file record + revision detection
        sid = metadata.record_source_file(
            engine, source_name=SOURCE_NAME, filename=dl.filename,
            url=dl.source_url, sha256=dl.sha256, size_bytes=len(dl.content),
            schema_version=registry.schema_version, raw_key=key,
            row_count=rows, data_month=data_month, status="success",
        )
        df_audit = df.copy()
        changed = metadata.upsert_period_versions(engine, df_audit, sid)

        metadata.finish_run(engine, run_id, status="success", rows_loaded=rows,
                            notes=f"changed_periods={changed}")
        log.info("INGESTION COMPLETE — %d rows, %d changed period-rows.",
                 rows, changed)
        return {"status": "success", "rows": rows, "changed": changed,
                "data_month": data_month}

    except Exception as err:
        log.exception("Ingestion failed: %s", err)
        if not dry_run and run_id != -1:
            metadata.finish_run(engine, run_id, status="failed", notes=str(err))
        raise

def run_backfill_web() -> dict:
    """Auto-backfill: scrape the year-pages, download + ingest each monthly file.

    No manual download. Files are processed in chronological order so SCD
    history builds correctly.
    """
    links = link_resolver.resolve_backfill_urls()
    if not links:
        log.error("No monthly files found on the year-pages.")
        return {"status": "no_files", "processed": 0}

    # sort chronologically by the period inside each file's name where possible;
    # fall back to URL order. We parse the period properly during ingestion, but
    # for ordering we sniff the month/year from the link text.
    def _sort_key(link):
        m = re.search(
            r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[\s-]+'?(\d{2,4})",
            link.link_text, re.IGNORECASE)
        if not m:
            return (9999, 99)
        months = ["jan","feb","mar","apr","may","jun",
                  "jul","aug","sep","oct","nov","dec"]
        mon = months.index(m.group(1)[:3].lower()) + 1
        yr = int(m.group(2))
        yr = yr + 2000 if yr < 100 else yr
        return (yr, mon)

    links = sorted(links, key=_sort_key)
    log.info("Auto-backfill: ingesting %d files oldest-first", len(links))

    results = []
    for link in links:
        log.info("=== Backfilling %s ===", link.link_text)
        try:
            dl = downloader.download(link.url)
            res = run_ingestion(downloaded=dl)
            results.append({"file": dl.filename, **res})
        except Exception as err:
            log.exception("Backfill failed for %s: %s", link.link_text, err)
            results.append({"file": link.link_text, "status": "failed",
                            "error": str(err)})

    ok = sum(1 for r in results if r.get("status") == "success")
    log.info("Auto-backfill complete: %d/%d succeeded", ok, len(links))
    return {"status": "done", "processed": len(links), "succeeded": ok,
            "results": results}


def _inspect() -> None:
    link = link_resolver.resolve_timeseries_url()
    dl = downloader.download(link.url)
    print(parser.inspect(dl.content))



def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="NHS A&E ingestion pipeline")
    ap.add_argument("--inspect", action="store_true",
                    help="download and print workbook structure, no DB writes")
    ap.add_argument("--dry-run", action="store_true",
                    help="resolve, download and parse, but do not load to DB")
    ap.add_argument("--backfill-web", action="store_true",
                    help="auto-scrape the year-pages and ingest all monthly files")
    args = ap.parse_args(argv)

    if args.backfill_web:
        result = run_backfill_web()
        log.info("Result: %s", result)
        if result.get("status") == "no_files":
            return 1
        failed = result.get("processed", 0) - result.get("succeeded", 0)
        return 1 if failed else 0

    if args.inspect:
        _inspect()
        return 0

    result = run_ingestion(dry_run=args.dry_run)
    log.info("Result: %s", result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
