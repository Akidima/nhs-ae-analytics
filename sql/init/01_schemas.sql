-- =====================================================================
-- NHS A&E Analytics — database schemas
--
-- Target database: POSTGRES_DB (nhs_ae)
--
-- Layers:
--   staging      = Silver: typed/cleaned 1:1 source data
--   intermediate = dbt transformation layer
--   marts        = Gold: dimensional models and business KPIs
--   meta         = Pipeline metadata and observability
--   reference    = Controlled lookup/reference data
--
-- This script is executed automatically by the PostgreSQL Docker
-- entrypoint when the database volume is initialized for the first time.
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
