# NHS A&E Demand and Emergency Admissions Analytics

An end-to-end, **zero-cost** data platform that ingests NHS England's Monthly
A&E Attendances and Emergency Admissions publication, models it into a
dimensional warehouse, validates it, and serves operational dashboards.

**Stack:** Python · PostgreSQL · Airflow · dbt · Great Expectations ·
Power BI / Superset · Docker · Terraform (LocalStack) · GitHub Actions

> Default build runs entirely on your laptop in Docker for **£0**.
> See `docs/appendices/appendix-a-zero-cost-edition.md`.

## Quick start

```bash
make up            # start postgres, minio, localstack, airflow
# Airflow UI: http://localhost:8080  (admin / admin)
# MinIO  UI:  http://localhost:9001
make psql          # open a SQL shell on the warehouse
make down          # stop (keeps data)
make clean         # destroy everything for a fresh start
```

## Layout

```
docker-compose.yml      full local stack
docker/                 service Dockerfiles (ingestion, dbt)
sql/init/               DB bootstrap (schemas + metadata catalog)
ingestion/              Python ingestion framework      (Phase 5)
dbt/                    transformation models           (Phase 8)
airflow/dags/           orchestration DAGs              (Phase 5)
config/schema_registry/ expected source schema (drift)  (Phase 5)
terraform/              IaC, runs vs LocalStack          (Phase 10)
.github/workflows/      CI/CD + free monthly run         (Phase 10)
docs/phases/            the full implementation guide (13 phases)
docs/appendices/        zero-cost edition + extras
```

## Documentation

Start with `docs/phases/phase-01-domain-understanding.md` and read in order.
Each phase opens with a plain-language "Explain Like I'm 10" summary, then the
production-grade detail.

## Licence / data

Source data is published by NHS England under the Open Government Licence v3.0.
