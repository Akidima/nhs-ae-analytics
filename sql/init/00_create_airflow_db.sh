#!/bin/bash
# Runs once on first Postgres init. Creates the Airflow metadata database
# alongside the analytics database (POSTGRES_DB=nhs_ae).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE airflow'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'airflow')\gexec
EOSQL

echo "airflow metadata database ensured"
