-- SCD Type 2 provider dimension, built from snap_provider.
--
-- Each row is one version of a provider. org_code is the business key 
-- (stable); provider_key is the surrogate (unique per version). When a 
-- provider's name changes, the snapshot creates a new version, so the same
-- org's code can have multiple rows with non-overlapping validity windows.
--
-- A fact's row joins on org_code AND its period falling within
-- (valid_from, valid_to), picking up the name that was current them.

with snap as (
    select
        org_code,
        org_name,
        dbt_valid_from,
        dbt_valid_to,
        dbt_scd_id
    from {{ref('snap_provider')}}
)

select
    -- surrogate key: unique per provider VERSION
    dbt_scd_id                                 as provider_key,

    -- Business key: stable across versions
    org_code,
    org_name,


    -- SCD2 validity window
    dbt_valid_from                             as valid_from,
    dbt_valid_to                               as valid_to,
    case when dbt_valid_to is null
         then true else false end              as is_current


from snap 