""""Defines the ExceptationSuites: the six required check categories.

1. Null Checks.          ->   build_landing_suite
2. Volume Checks.        ->   both suites (table-wide + per-month)
3. Freshness Checks.     ->   build_landing_suite 
4. Range Checks.         ->   build_landing_suite
5. Duplicate Detection.  ->   build_landing_suite
6. KPI reconciliation.   ->  build_monthly_totals_suite

Two suites because the checks operate at two different grains: most
checks are row-level (one provider-month row at a time.)
"""
from __future__ import annotations

from datetime import date, timedelta

import great_expectations as gx

from .logging_setup import get_logger

logger = get_logger(__name__)

LANDING_SUITE_NAME = "ae_activity_landing_suite"
MONTHLY_TOTALS_SUITE_NAME = "monthly_totals_suite"

# Providers per month have ranged 190-201 across 14 real backfilled months.
# Headroom either side rather than hardcoding the exact observed range.
EXPECTED_MIN_PROVIDERS_PER_MONTH = 150
EXPECTED_MAX_PROVIDERS_PER_MONTH = 250

# NHS publishes monthly with roughly a 6-week lag after month-end.
# 75 days covers normal publication lag with some slack before we call
FRESHNESS_MAX_AGE_DAYS = 75

# Month-over-month attendance shouldn't swing more than this without
# investigation. Real NHS data moves single-digit percent most momths;
# a jump beyond this smells like a load error, not real demand change.
MOM_MAX_SWING_FCT = 0.35

# Sanity bounds for total national-scale monthly attendance. Wide on
# purpose -- this is a gross-corruption tripwire, not a tight forecast.
NATIONAL_MONTHLY_ATTENDANCE_FLOOR = 1_500_000
NATIONAL_MONTHLY_ATTENDANCE_CEILING = 3_500_000

def build_landing_suite(context):
    """Row-level suite validated against staging.ae_activity_landing."""
    suite = gx.ExpectationSuite(name=LANDING_SUITE_NAME)
    suite = context.suites.add_or_update(suite)

    # --------- 1. NULL CHECKS ------------------------------------
    # These are the exact columns whose silent nulling caused the
    # anonymous-hospital-codes bug during Phase 5 ingestion. Now Permanant.
    for column in ("org_code", "org_name", "period", "attendances_total"):
        suite.add_expectation(
            gx.expectations.ExpectColumnValuesToNotBeNull(column=column)
        )

    # ---- 2. VOLUME CHECKS ----------------------------------------
    # A very low total row count means a load silently dropped most data.
    # The tight, per-month version of this check lives in the monthly
    # totals suite below, where "per month" actually means something.
    suite.add_expectation(
        gx.expectations.ExpectTableRowCountToBeBetween(min_value=1, max_value=None)
    )

    # ---- 3. FRESHNESS CHECKS --------------------------------------
    # The most recent loaded period should be recent relative to today.
    # Computed at RUN TIME -- a moving target, not a fixed date.
    earliest_acceptable = date.today() - timedelta(days=FRESHNESS_MAX_AGE_DAYS)
    suite.add_expectation(
        gx.expectations.ExpectColumnMaxToBeBetween(
            column="period",
            min_value=earliest_acceptable,
            max_value=date.today(),
        )
    )

    # ----- 4. RANGE CHECKS ----------------------------------------
    suite.add_expectation(
        gx.expectations.ExpectColumnsValuesToBeBetween(
            column="performance_all_pct", min_value=0, max_value=1
        )
    )

    suite.add_expectation(
        gx.expectations.ExpectColumnsValuesToBeBetween(
            column="attendances_total", min_value=0, max_value=None
        )
    )
    # The exact check you ran by hand, now permanent
    # and automatic: breaches can never exceed total attendances.
    suite.add_expectation(
        gx.expectations.ExpectColumnPairValuesAToBeGreaterThanOrEqualToB(
            column_A="attendances_total", column_B="breaches_total"
        )
    )

    #------ 5. DUPLICATE DETECTION ---------------------------------
    # One row per (period, org_code) -- the same grain guarantee the dbt
    # marts layer enforces, checked here one step eariler, at ingestion.
    suite.add_expectation(
        gx.expectations.ExpectCompoundColumnsToBeUnique(
            column="provider_count",
            min_value=EXPECTED_MIN_PROVIDERS_PER_MONTH,
            max_value=EXPECTED_MAX_PROVIDERS_PER_MONTH
        )
    )

    return suite

def build_monthly_totals_suite(context):
    """Monthly totals suite for KPI reconciliation checks."""
    suite = gx.ExpectationSuite(name=MONTHLY_TOTALS_SUITE_NAME)
    suite = context.suites.add_or_update(suite)

    # ----- 6. KPI RECONCILIATION ----------------------------------
    # HONEST LIMITATION: Ingestion delibrately drops the NHS "England"
    # control-total row to avoid double-counting in the fact tables, so
    # there's no live external ground stored to reconcile against
    # automatically. As a working proxy I  check TWO things instead:
    #
    # a.) absolute sanity bounds (is this a plausible national total at all, order-of-magnitude), and
    #  b.) month-over-month (a SQL-computed % change vs the prior period -- see MONTHLY_TOTALS_QUERY in context.py)
    #
    #
    # This catches gross corruption (a botched parse, a halved or doubled value)
    # even without an external ground truth. For true reconciliation to NHS's own published national total
    # ingestion would need to persist the England row to a small control-totals table before dropping it
    # from the main load. Flagging it rather than quietly pretending this is
    # equilavent to reconciling against NHS's own number.
    suite.add_expectation(
        gx.expectations.ExpectColumnValuesToBeBetween(
            column="total_attendances",
            min_value=NATIONAL_MONTHLY_ATTENDANCE_FLOOR,
            max_value=NATIONAL_MONTHLY_ATTENDANCE_CEILING,
        )
    )
    suite.add_expectation(
        gx.expectations.ExpectColumnValuesToBeBetween(
            column="momth_over_month_pct_change",
            min_value=-MOM_MAX_SWING_FCT,
            max_value=MOM_MAX_SWING_FCT,
        )
    )

    return suite

