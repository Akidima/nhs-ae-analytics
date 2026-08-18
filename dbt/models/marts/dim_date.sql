-- dim_date
-- One row per reporting month present in the data, with attributes that
-- matter for NHS A&E analysis:
-- * NHS financial year (Apr–Mar): e.g. July 2026 falls in FY 2026/27
-- * winter-pressure flag (Dec–Mar)
-- * calendar parts for slicing
--
-- Surrogate key date_key is the period as integer YYYYMM.

with periods as (
    select distinct period
    from {{ ref('stg_ae_activity') }}
),

dim as (
    select
        cast(to_char(period, 'YYYYMM') as integer)   as date_key,
        period,
        extract(year from period)::int               as calendar_year,
        extract(month from period)::int              as calendar_month,
        trim(to_char(period, 'Month'))               as month_name,
        extract(quarter from period)::int            as calendar_quarter,

        -- NHS financial year starts in April
        case
            when extract(month from period) >= 4
                then extract(year from period)::int
            else extract(year from period)::int - 1
        end                                          as fy_start_year,

        case
            when extract(month from period) in (12, 1, 2, 3)
                then true
            else false
        end                                          as is_winter
    from periods
)

select
    date_key,
    period,
    calendar_year,
    calendar_month,
    month_name,
    calendar_quarter,
    fy_start_year,
    (fy_start_year::text || '/' || right((fy_start_year + 1)::text, 2))
        as financial_year,
    is_winter
from dim
