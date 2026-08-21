# =====================================================================
# Ingestion app image — Python 3.12, all pipeline dependencies
# Build:  docker build -f docker/ingestion.Dockerfile -t nhs-ae-analytics:ingestion .
# =====================================================================
FROM python:3.12-slim

# System deps for psycopg2 + lxml builds
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY ingestion/ ./ingestion/
COPY config/ ./config/

ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app

# Default entrypoint for K8s Jobs
ENTRYPOINT ["python", "-m", "ingestion.run"]
