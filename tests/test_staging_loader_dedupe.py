"""Regression tests: staging_loader._dedupe keeps last duplicate per key.

Guards the fix for the 'will be deduped' lie — duplicates used to flow into
staging AND create two 'is_current' SCD versions for the same (period,
org_code).
"""
from __future__ import annotations

import pandas as pd
import pytest

from ingestion.staging_loader import _dedupe


def _frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def test_dedupe_keeps_last_occurrence():
    df = _frame([
        {"period": pd.Timestamp("2026-07-01"), "org_code": "R1A",
         "attendances_total": 100},
        {"period": pd.Timestamp("2026-07-01"), "org_code": "R1A",
         "attendances_total": 150},  # amended row, must win
        {"period": pd.Timestamp("2026-07-01"), "org_code": "R1B",
         "attendances_total": 200},
    ])
    out = _dedupe(df)
    assert len(out) == 2
    assert out.loc[out["org_code"] == "R1A", "attendances_total"].item() == 150
    assert out.loc[out["org_code"] == "R1B", "attendances_total"].item() == 200


def test_dedupe_noop_when_unique():
    df = _frame([
        {"period": pd.Timestamp("2026-07-01"), "org_code": "R1A"},
        {"period": pd.Timestamp("2026-07-01"), "org_code": "R1B"},
    ])
    out = _dedupe(df)
    assert len(out) == 2
    # same object semantics preserved for the no-duplicate path
    assert out is df


def test_dedupe_scopes_to_period_and_org():
    df = _frame([
        {"period": pd.Timestamp("2026-06-01"), "org_code": "R1A", "v": 1},
        {"period": pd.Timestamp("2026-07-01"), "org_code": "R1A", "v": 2},
    ])
    out = _dedupe(df)
    # Same org across different periods is NOT a duplicate
    assert len(out) == 2


def test_dedupe_empty_frame():
    df = pd.DataFrame(columns=["period", "org_code"])
    out = _dedupe(df)
    assert out.empty
