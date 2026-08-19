\timing off
select length(org_code) as len, 
        count(*) as bad_rows,
        count(DISTINCT org_code) AS distinct_bad_codes
from staging.ae_activity_landing
where org_code IS NULL 
    OR org_code !~ '^[A-Z0-9]{3,5}$'
group by length(org_code)
order by len;