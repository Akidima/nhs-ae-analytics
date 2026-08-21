"""CLI entry point for running the NHS A&E quality checkpoint.

    python -m quality.run_validation

Exit code 0 = all expectations passed
Exit code 1 = at least one expectation failed

Intended sequencing (Makefile, shell, or later an Airflow DAG):
1. Run the ingestion pipeline
2. Run this validation script
3. If validation passes, proceed with downstream processing
4. If validation fails, notify stakeholders and halt downstream processing

    python -m ingestion.run && \
    python -m quality.run_validation && \
    dbt build
"""
