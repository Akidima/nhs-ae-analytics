# =====================================================================
# Ingestion app image — Python 3.12, all pipeline dependencies
# =====================================================================
FROM python:3.12-slim

# System deps for psycopg2 + lxml builds
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code is mounted as a volume in dev (docker-compose); copy for prod builds.
COPY ingestion/ ./ingestion/
COPY config/ ./config/

ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app

# Default: show help. Real invocation: `python -m ingestion.run`
CMD ["python", "-c", "print('NHS A&E ingestion image. Run: python -m ingestion.run')"]
