-- stg_ae_activity
-- The "silver" layer: one clean, typed row per provider per month.
--
-- Deliberately thin. The Python ingestion pipeline already:
--   * parsed the messy two-row NHS header into canonical columns,
--   * dropped the England aggregate row,
--   * corrected breach semantics (>4hr, not <4hr),
--   * validated breaches <= attendances and reconciled to national totals.
-- So here we only standardise types and names, and compute the within-4hr
-- count as a convenience (breaches are published; "met" is derived).

with source as (
    select * from {{ source('landing', 'ae_activity_landing') }}
),

cleaned as (
    select
        -- keys
        cast(period as date)                       as period,
        cast(org_code as text)                     as org_code,
        cast(org_name as text)                     as org_name,

        -- attendance measures
        cast(attendances_type1 as bigint)          as attendances_type1,
        cast(attendances_type2 as bigint)          as attendances_type2,
        cast(attendances_type3 as bigint)          as attendances_type3,
        cast(attendances_total as bigint)          as attendances_total,

        -- breach measures (waited > 4 hours)
        cast(breaches_type1 as bigint)             as breaches_type1,
        cast(breaches_total as bigint)             as breaches_total,

        -- derived: attendances seen within 4 hours
        cast(attendances_total as bigint)
            - cast(breaches_total as bigint)       as within_4hr_total,

        -- published performance percentage (0-1 fraction)
        cast(performance_all_pct as numeric)       as performance_all_pct,

        -- emergency admissions
        cast(emergency_admissions_type1 as bigint) as emergency_admissions_type1,
        cast(emergency_admissions_via_ae as bigint) as emergency_admissions_via_ae,
        cast(emergency_admissions_other as bigint) as emergency_admissions_other,
        cast(emergency_admissions_total as bigint) as emergency_admissions_total,

        -- decision-to-admit waits
        cast(dta_breaches_4hr as bigint)           as dta_breaches_4hr,
        cast(dta_breaches_12hr as bigint)          as dta_breaches_12hr,

        -- audit passthrough
        cast(source_file_name as text)             as source_file_name,
        cast(ingested_at as timestamptz)           as ingested_at
    from source
    where org_code is not null
)

select * from cleaned
