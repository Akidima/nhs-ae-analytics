"""NHS A & E Ingestion Framework


Modules:
    settings        configuration from environment
    logging_setup   logging configuration
    hashing         file + row hashing (revision detection)
    link_resolver   scrape the NHS page, resolve the random-suffix URL
    downloader      download with retries
    storage         raw zone writer (MinIO / S3) + manifest management
    schema          schema registry: header detection + column mapping + drift
    parser          .xls -> tidy DataFrame
    staging_loader  DataFrame -> PostgresSQL staging table
    metadata        write to the meta.* catalog (source_file, period_version, run)
    run.            orchestrator + CLI entry point
"""

__version__ = "0.1.0"