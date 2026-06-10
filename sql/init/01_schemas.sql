-- =====================================================================
-- Schemas for the layered architecture (Phase 3 §3)
-- Runs against POSTGRES_DB (nhs_ae) on first init.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS staging;       -- silver: typed, cleaned source rows
CREATE SCHEMA IF NOT EXISTS intermediate;  -- dbt intermediate models
CREATE SCHEMA IF NOT EXISTS marts;         -- gold: dim_* / fact_* (the warehouse)
CREATE SCHEMA IF NOT EXISTS meta;          -- metadata catalog (Phase 2 §11)
CREATE SCHEMA IF NOT EXISTS reference;      -- ICB mapping, CRS-trust list, etc.

COMMENT ON SCHEMA staging      IS 'Silver layer: typed/cleaned 1:1 source rows';
COMMENT ON SCHEMA intermediate IS 'dbt intermediate transformations';
COMMENT ON SCHEMA marts        IS 'Gold layer: dimensional model + KPIs';
COMMENT ON SCHEMA meta         IS 'Pipeline metadata catalog (files, versions, drift, reconciliation)';
COMMENT ON SCHEMA reference    IS 'Reference data: ICB mapping, CRS field-test trusts, etc.';
