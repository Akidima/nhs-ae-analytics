"""Central Configuration, read from environment variables

  Everything configurable lives here so the same code runs locally, in CI, and
  in cloud(localstack, aws, etc.) only the *values* change.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

@dataclass(frozen=True)
class Settings:
    # Source Page
    landing_page_url: str = os.environ.get(
        "LANDING_PAGE_URL", 
        "https://www.england.nhs.uk/statistics/statistical-work-areas/ae-waiting-times-and-activity/"
    )
    # Link text we search for on the landing page (case-insensitive contains)
    timeseries_link: str = "Monthly A&E Time Series"

    # Raw zone (Minio/S3)
    minio_endpoint: str = os.environ.get("MINIO_ENDPOINT", "http://minio:9000")
    raw_bucket: str = os.environ.get("RAW_BUCKET", "nhs-ae-raw")
    aws_access_key_id: str = os.environ.get("AWS_ACCESS_KEY_ID", "minioadmin")
    aws_secret_access_key: str = os.environ.get("AWS_SECRET_ACCESS_KEY", "minioadmin_local_pw")
    aws_region: str = os.environ.get("AWS_REGION", "eu-west-2")

    #Database
    db_url: str = os.environ.get(
        "NHS_AE_DB_URL",
        "postgresql+psycopg2://nhs:nhs_local_pw@postgres:5432/nhs_ae"
    )
    
#Schema Registry
    schema_registry_path: str = os.environ.get(
        "SCHEMA_REGISTRY_PATH",
        # works in both the ingestion image (/app) and airflow (/opt/airflow)
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "config",
            "schema_registry",
            "msitae_activity.yml"
        )
    )

#Behaviour
    download_retries: int = int(os.environ.get("DOWNLOAD_RETRIES", "4"))
    log_level: str = os.environ.get("LOG_LEVEL", "INFO")

settings = Settings()
