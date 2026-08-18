-- dim_provider
-- SCD Type 2 provider dimension built from staging history.
-- A new version starts when org_name changes for an org_code.
-- Facts join on org_code and period within [valid_from, valid_to).

with src as (
    select distinct
        period,
        org_code,
        org_name
    from {{ ref('stg_ae_activity') }}
),

marked as (
    select
        org_code,
        org_name,
        period,
        case
            when lag(org_name) over (
                partition by org_code order by period
            ) is distinct from org_name then 1
            else 0
        end as is_new_version
    from src
),

grouped as (
    select
        org_code,
        org_name,
        period,
        sum(is_new_version) over (
            partition by org_code order by period
            rows unbounded preceding
        ) as version_grp
    from marked
),

ranges as (
    select
        org_code,
        org_name,
        min(period) as valid_from,
        version_grp
    from grouped
    group by org_code, org_name, version_grp
)

select
    {{ dbt_utils.generate_surrogate_key(['org_code', 'valid_from']) }}
        as provider_key,
    org_code,
    org_name,
    valid_from,
    lead(valid_from) over (
        partition by org_code order by valid_from
    ) as valid_to,
    lead(valid_from) over (
        partition by org_code order by valid_from
    ) is null as is_current
from ranges
