-- Down migration 127: Reconcile historical provenance
SET XACT_ABORT ON;

-- Historical rows remain UNKNOWN on rollback as original provenance is unverified
