-- Down-migration 128: Reconcile unverified mirror provenance rollback
SET XACT_ABORT ON;

-- Revert is a no-op as historical unknown status cannot be safely guessed back
SELECT 1;
