"""Immutable raw zone on MinIO (S3-compatible).

The same boto3 code works against real AWS S3 — only the endpoint differs
(Phase 4 / Appendix A). Files are partitioned by ingest date and never edited.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone

import boto3
from botocore.client import Config

from .logging_setup import get_logger
from .settings import settings

log = get_logger(__name__)


class RawStorage:
    def __init__(self) -> None:
        self._s3 = boto3.client(
            "s3",
            endpoint_url=settings.minio_endpoint,     # remove for real AWS S3
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        self._bucket = settings.raw_bucket

    def ensure_bucket(self) -> None:
        existing = [b["Name"] for b in self._s3.list_buckets().get("Buckets", [])]
        if self._bucket not in existing:
            self._s3.create_bucket(Bucket=self._bucket)
            log.info("Created bucket %s", self._bucket)

    @staticmethod
    def build_key(filename: str, ingest_day: date | None = None) -> str:
        """Partitioned key: msitae/ingest_date=YYYY-MM-DD/<filename>."""
        day = (ingest_day or date.today()).isoformat()
        return f"msitae/ingest_date={day}/{filename}"

    def put_file(self, key: str, content: bytes) -> str:
        self._s3.put_object(Bucket=self._bucket, Key=key, Body=content)
        log.info("Stored raw file: s3://%s/%s", self._bucket, key)
        return key

    def write_manifest(self, file_key: str, manifest: dict) -> str:
        manifest_key = f"{file_key}.manifest.json"
        self._s3.put_object(
            Bucket=self._bucket,
            Key=manifest_key,
            Body=json.dumps(manifest, indent=2, default=str).encode("utf-8"),
            ContentType="application/json",
        )
        log.info("Wrote manifest: s3://%s/%s", self._bucket, manifest_key)
        return manifest_key

    def get_file(self, key: str) -> bytes:
        obj = self._s3.get_object(Bucket=self._bucket, Key=key)
        return obj["Body"].read()


def build_manifest(
    *, source_name: str, source_url: str, filename: str, sha256: str,
    size_bytes: int, raw_key: str, schema_version: str | None,
    data_month: str | None, row_count: int | None,
) -> dict:
    return {
        "source": source_name,
        "source_url": source_url,
        "original_filename": filename,
        "data_month": data_month,
        "ingest_timestamp": datetime.now(timezone.utc).isoformat(),
        "file_size_bytes": size_bytes,
        "sha256": sha256,
        "raw_storage_path": raw_key,
        "schema_version_detected": schema_version,
        "row_count_parsed": row_count,
    }
