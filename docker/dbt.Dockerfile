# =====================================================================
# dbt Core image with the Postgres adapter
# Build:  docker build -f docker/dbt.Dockerfile -t nhs-ae-analytics:dbt .
# =====================================================================
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# dbt Core + Postgres adapter (versions indicative — bump as needed)
RUN pip install --no-cache-dir dbt-core==1.8.8 dbt-postgres==1.8.2

WORKDIR /dbt
ENV DBT_PROFILES_DIR=/dbt

# Copy dbt project (for K8s Jobs; docker-compose mounts volume instead)
COPY dbt/ /dbt/

# Default entrypoint for K8s Jobs
ENTRYPOINT ["dbt"]
CMD ["--version"]
