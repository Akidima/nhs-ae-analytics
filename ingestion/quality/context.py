"""Build the Great Expectations Data Context and data assets for the data quality service.

Uses the GX 1.x Fluent API (Data Source -> Data Asset -> Batch Definition),
NOT the legacy 0.x DataContext/BatchRequest API. Config (great_expectations.yml,
expectations/*.json, validation results) is auto-persisted under ./gx when
using a FILE-backed context -- those generated files ARE the "configuration
files" deliverable for this phase. They're produced the first time this
runs, not hand-written, which is how the modern Fluent API works.

WHERE WE VALIDATE: staging.ae_activity_landing (the raw ingestion landing
table), not the dbt marts. Catching bad data at the ingestion boundary
stops it reaching the star schema. dbt's own tests (Phase 6) still cover
the transformation layer -- this is an earlier, separate checkpoint.

NOTE ON VERSION SENSITIVITY: the query-asset + batch-definition method
names below (add_query_asset / add_batch_definition_whole_table) match
the GX 1.x Fluent API as documented at the time this was written. GX's
API has moved fast across 1.x releases. If your installed version raises
an AttributeError on either call, check
`python -c "import great_expectations as gx; help(gx.get_context().data_sources.add_postgres)"`
and adjust the method name -- the concepts (data source -> asset -> batch
definition) will still apply even if a method got renamed.
"""

from __future__ import annotations

from pathlib import Path

import great_expectations as gx

from .logging_setup import get_logger
from .settings import settings

log = get_logger(__name__)
GX_PROJECT_ROOT = Path(__file__).resolve().parent.parent / "gx"

DATASOURCE_NAME = "nhs_ae_postgres"
LANDING_ASSET_NAME = "ae_activity_landing"
LANDING_SCHEMA = "staging"
LANDING_TABLE = "ae_activity_landing"

# One row per period of time (e.g. 1 day) to validate, with the most recent period first.
# month-over-month percent change. Doing the aggregation and the lag
# calculation in SQL is more efficient than doing it in Python after the fact.
# The SQL query below is a template, with the date range filled in by GX at runtime 
# GX has no built-in "compare this row" to the previous row expectation.
# so we hand it a column that already contains the lagged value, and then we can compare the two columns.

MONTHLY_ACTIVITY_QUERY = """
    with monthly as (
        select
            period,
            count(*)                                        as provider_count,
            sum(attendances_total)                          as total_attendances,  
            sum(breaches_total)                             as total_breaches      
        from staging.ae_activity_landing
        group by period
    )
    select 
        period,
        provider_count,
        total_attendances,
        total_breaches,
        lag(total_attendances) over (order by period) as prior_month_attendances,
        case
            when lag(total_attendances) over (order by period) is null 
                then 0.0
            else (total_attendances
                - lag(total_attendances) over (order by period))::numeric
                / lag(total_attendances) over (order by period)
        end as month_over_month_pct_change
    from monthly
    order by period
"""

def get_context():
    """Return a file-based GX context, creating ./gx config on first run."""
    GX_PROJECT_ROOT.mkdir(parents=True, exist_ok=True)
    context = gx.get_context(mode="file", project_root_dir=str(GX_PROJECT_ROOT))
    log.info("GX Context created.")
    return context  

def _get_or_add_datasource(context):
    try:
        return context.data_sources.get(DATASOURCE_NAME)
    except (KeyError, LookupError):
        return context.data_sources.add_postgres(
            name=DATASOURCE_NAME, connection_string=settings.db_url
        )

def get_landing_batch_definition(context):
    """Whole-table batch over staging.ae_activity_landing (row-level checks)."""
    datasource = _get_or_add_datasource(context)

    # FIX: Properly indented inside the function
    try:
        asset = datasource.get_asset(LANDING_ASSET_NAME)
    except (KeyError, LookupError):
        asset = datasource.add_table_asset(
            name=LANDING_ASSET_NAME,
            table_name=LANDING_TABLE,
            schema_name=LANDING_SCHEMA
        )
    
    # FIX: Properly indented inside the function
    try: 
        return asset.get_batch_definition("landing_whole_table")
    except (KeyError, LookupError):
        return asset.add_batch_definition_whole_table("landing_whole_table")


def get_monthly_totals_batch_definition(context):
    """Query-based batch: one row per period with aggregates + MoM change.

    Back-volume-per-month and KPI reconciliation checks, which need 
    aggregation the row-level landing suite can't express directly.
    """
    datasource = _get_or_add_datasource(context)

    try: 
        asset = datasource.get_asset("monthly_totals")
    except (KeyError, LookupError):
        asset = datasource.add_query_asset(
            # FIX: Changed MONTHLY_TOTAL_QUERY to MONTHLY_ACTIVITY_QUERY
            name="monthly_totals", query=MONTHLY_ACTIVITY_QUERY 
        )
    
    try:
        return asset.get_batch_definition("monthly_total_whole")
    except (KeyError, LookupError):
        return asset.add_batch_definition_whole_table("monthly_total_whole")