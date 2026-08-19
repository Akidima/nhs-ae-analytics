-- fct_ae_activity
-- Fact table at period × provider grain.
-- Measures come from staging; keys come from dim_date / dim_provider.

select
    d.date_key,
    p.provider_key,
    s.period,
    s.org_code,

    s.attendances_type1,
    s.attendances_type2,
    s.attendances_type3,
    s.attendances_total,

    s.breaches_type1,
    s.breaches_total,
    s.within_4hr_total,

    s.performance_all_pct,

    s.emergency_admissions_type1,
    s.emergency_admissions_via_ae,
    s.emergency_admissions_other,
    s.emergency_admissions_total,

    s.dta_breaches_4hr,
    s.dta_breaches_12hr,

    s.source_file_name,
    s.ingested_at
from {{ ref('stg_ae_activity') }} s
inner join {{ ref('dim_date') }} d
    on s.period = d.period
inner join {{ ref('dim_provider') }} p
    on s.org_code = p.org_code
   and s.period >= p.valid_from
   and (p.valid_to is null or s.period < p.valid_to)
