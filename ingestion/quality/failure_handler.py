"""Turn a GX checkpoint result into a clear, actionable outcome.

Philosophy carried over from the ingestion pipeline: a run should either
succeed cleanly or fail LOUDLY with enough detail to act on -- never a 
silent pass on bad data. This module is the enforcement point, and its exit code 
is what a pipeline (Makefile target, shell script, or Airflow) 
should key off to decide whether to proceed to dbt.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .logging_setup import get_logger

logger = get_logger(__name__)

REPORT_DIR = Path(__file__).resolve().parent.parent / "quality_reports"

def summarise(checkpoint_result) -> dict:
    """Pull a compact, human-readable summary out of the raw GX result."""
    summary = {
        "success": checkpoint_result.success,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "validations": [],
    }
    for _key, run_result in checkpoint_result.run_results.items():
        validation_result = run_result["validation_result"]
        failed = [
            {
                "expectation": r.expectation_config.type,
                "column": (
                    r.expectation_config.kwargs.get("column")
                    or r.expectation_config.kwargs.get("column_list")
                    or r.expectation_config.kwargs.get("column_A")
                ),
                "unexpected_count": r.result.get("unexpected_count"),
                "unexpected_percent": r.result.get("unexpected_percent"),
            }
            for r in validation_result.results
            if not r.success
        ]
        summary["validations"].append({
            "success": validation_result.success,
            "evaluated_expectations": validation_result.statistics.get(
                "evaluated_expectations"
            ),
            "successful_expectations": validation_result.statistics.get(
                "successful_expectations"
            ),
            "failed_expectations": failed,
        })
    return summary

def handle(checkpoint_result) -> int:
    """Process a checkpoint result. Returns the process exit code to use.
    
    0 = every expectation passed, safe for dbt to run next.
    1 = at least one expectation failed, do not run dbt.
    """
    summary = summarise(checkpoint_result)
    
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report_path = REPORT_DIR / f"quality_run_{stamp}.json"
    report_path.write_text(json.dumps(summary, indent=2, default=str))

    if summary["success"]:
        logger.info("DATA QUALITY: PASS -- all expectations met. Report: %s", report_path)
        return 0

    logger.error("DATA QUALITY: FAIL -- at least one or more expectations failed/violated. Report: %s", report_path)
    for validation in summary["validations"]:
        for failure in validation["failed_expectations"]:
            logger.error(
                " FAILED: %s on %s (unexpected=%s, %.1f%%)",
                failure["expectation"],
                failure["column"],
                failure["unexpected_count"],
                failure["unexpected_percent"] or 0,
            )
    logger.error("Full report written to: %s", report_path)
    logger.error(
        "PIPELINE HALTED -- downstream dbt build should NOT run against "
        "data that failed these checks. Investigate and fix the data quality issues "
        "before running the pipeline again."
    )
      # Hook point for a real notification integration -- e.g. post `summary`
    # to a Slack webhook or send an email here. Left as a deliberate stub:
    # no real webhook/credentials exist in this project, and a fake one
    # would be worse than an honest gap. Wire in your own here if wanted:
    #
    #   if not summary["success"]:
    #       requests.post(SLACK_WEBHOOK_URL, json={"text": "..."})
    #
    return 1

