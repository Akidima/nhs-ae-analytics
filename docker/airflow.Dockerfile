# =====================================================================
# Custom Airflow image — bakes in NHS A&E deps + code (faster startup)
# Build:  docker build -f docker/airflow.Dockerfile -t nhs-ae-analytics:airflow .
# =====================================================================
FROM apache/airflow:2.9.3-python3.12

# Install system deps for psycopg2, lxml, and any native extensions
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*
USER airflow

# Python deps — match docker-compose.yml PIP_ADDITIONAL_REQUIREMENTS exactly
# (keep in sync with requirements.txt + any Airflow-specific pins)
# Airflow 2.9.3 requires SQLAlchemy<2.0, so pin to 1.4.x
RUN pip install --no-cache-dir \
    requests==2.32.3 \
    beautifulsoup4==4.12.3 \
    lxml==5.3.0 \
    pandas==2.2.3 \
    xlrd==2.0.1 \
    openpyxl==3.1.5 \
    SQLAlchemy==1.4.46 \
    psycopg2-binary==2.9.10 \
    boto3==1.35.76 \
    pandera==0.21.0 \
    python-dotenv==1.0.1 \
    PyYAML==6.0.2

# Copy project code into the image (used by K8s ConfigMaps as source)
COPY --chown=airflow:root ingestion/ /opt/airflow/ingestion/
COPY --chown=airflow:root config/ /opt/airflow/config/
COPY --chown=airflow:root airflow/dags/ /opt/airflow/dags/
COPY --chown=airflow:root airflow/plugins/ /opt/airflow/plugins/

# Default command — overridden in K8s deployments
CMD ["airflow", "version"]