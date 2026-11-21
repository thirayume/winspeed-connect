-- ============================================================================
-- r740-uat-rebate-adopt.sql  (UAT only, run by host/Refresh-UAT.ps1 after every nightly restore)
-- Owner, 21 Nov 2026: Rebate and every other function stay on in UAT, with the same state as PROD.
-- The nightly restore copies PROD's Rebate reset state (EnvironmentKind 'production', primary
-- dbwins_worldfert9, PROD's manifest digest). UAT's backend reads only its own 'uat' state, so without
-- this step every fenced Rebate route answered 503 and a UAT bootstrap was refused.
-- This relabels the copied state as UAT's own: EnvironmentKind 'production' -> 'uat', the primary
-- database -> dbwins_worldfert9_uat, the manifest digest -> UAT's (sqlcmd variable UatDigest, from
-- backend/scripts/rebate-manifest-digest.js in the UAT container). Balances, queue, cursor and history
-- stay exactly as copied. wf only; the database is overwritten again by the next restore.
-- Repeatable: a copy already relabelled is left as it is. One transaction; any error rolls it back.
-- Usage: sqlcmd -b -I -S .\SQL2008 -E -d dbwins_worldfert9_uat -v UatDigest=<64 hex> -i r740-uat-rebate-adopt.sql
-- SQL Server 2008 R2, compatibility 80.
-- ============================================================================
SET XACT_ABORT ON; SET LOCK_TIMEOUT 20000; SET NOCOUNT ON;
SET ANSI_NULLS ON; SET ANSI_WARNINGS ON; SET QUOTED_IDENTIFIER ON; SET ARITHABORT ON;
SET ANSI_PADDING ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() <> 'dbwins_worldfert9_uat' OR @@SERVERNAME <> 'R740-SRV\SQL2008'
    RAISERROR('UAT_ADOPT_WRONG_DATABASE: this step runs on dbwins_worldfert9_uat only', 16, 1);
GO
DECLARE @digest char(64); SET @digest = LOWER('$(UatDigest)');
IF LEN(@digest) <> 64 OR @digest LIKE '%[^0-9a-f]%'
    RAISERROR('UAT_ADOPT_DIGEST_INVALID', 16, 1);
GO
BEGIN TRAN;
GO
DECLARE @digest char(64); SET @digest = LOWER('$(UatDigest)');
DECLARE @prod int, @uat int;
SELECT @prod = SUM(CASE WHEN EnvironmentKind = 'production' THEN 1 ELSE 0 END),
       @uat = SUM(CASE WHEN EnvironmentKind = 'uat' THEN 1 ELSE 0 END)
FROM wf.RebateResetCoordinator WITH (UPDLOCK, HOLDLOCK);
IF ISNULL(@prod, 0) > 0 AND ISNULL(@uat, 0) > 0
    RAISERROR('UAT_ADOPT_BOTH_STATES: the copy holds both a production and a uat coordinator', 16, 1);
IF ISNULL(@prod, 0) = 0
BEGIN
    SELECT 'UAT_ADOPT_SKIPPED' AS Result, ISNULL(@uat, 0) AS UatCoordinators,
           (SELECT TOP 1 CASE WHEN ManifestDigest = @digest THEN 'digest ok' ELSE 'digest differs' END
              FROM wf.RebateResetCoordinator WHERE EnvironmentKind = 'uat') AS UatDigest;
END
ELSE
BEGIN
    DECLARE @accruals int; SELECT @accruals = COUNT(*) FROM wf.RebateShipmentAccrual;
    -- Accrual rows are immutable for the business; this relabel of a restored copy is the one allowed change.
    IF @accruals > 0 DISABLE TRIGGER wf.trg_RebateShipmentAccrual_Verified ON wf.RebateShipmentAccrual;
    ALTER TABLE wf.RebateResetAttemptTarget NOCHECK CONSTRAINT FK_RebateResetAttemptTarget_Attempt;
    ALTER TABLE wf.RebateResetClaimCancellation NOCHECK CONSTRAINT FK_RebateResetClaimCancellation_Receipt;

    DECLARE @n TABLE (TableName sysname, RowsChanged int);
    UPDATE wf.RebateResetCoordinator SET EnvironmentKind = 'uat', PrimaryDatabase = 'dbwins_worldfert9_uat', ManifestDigest = @digest
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateResetCoordinator', @@ROWCOUNT);
    UPDATE wf.RebateResetParticipant SET EnvironmentKind = 'uat', ManifestDigest = @digest
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateResetParticipant', @@ROWCOUNT);
    UPDATE wf.RebateResetBootstrap SET EnvironmentKind = 'uat', PrimaryDatabase = 'dbwins_worldfert9_uat', ManifestDigest = @digest
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateResetBootstrap', @@ROWCOUNT);
    UPDATE wf.RebateResetBootstrapTarget SET EnvironmentKind = 'uat',
      DatabaseName = CASE WHEN DatabaseName = 'dbwins_worldfert9' THEN 'dbwins_worldfert9_uat' ELSE DatabaseName END
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateResetBootstrapTarget', @@ROWCOUNT);
    UPDATE wf.RebateResetAttempt SET EnvironmentKind = 'uat', ManifestDigest = @digest
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateResetAttempt', @@ROWCOUNT);
    UPDATE wf.RebateResetAttemptTarget SET EnvironmentKind = 'uat',
      DatabaseName = CASE WHEN DatabaseName = 'dbwins_worldfert9' THEN 'dbwins_worldfert9_uat' ELSE DatabaseName END
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateResetAttemptTarget', @@ROWCOUNT);
    UPDATE wf.RebateResetReceipt SET EnvironmentKind = 'uat', ManifestDigest = @digest
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateResetReceipt', @@ROWCOUNT);
    UPDATE wf.RebateResetClaimCancellation SET EnvironmentKind = 'uat'
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateResetClaimCancellation', @@ROWCOUNT);
    UPDATE wf.RebateShipmentEvidence SET EnvironmentKind = 'uat'
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateShipmentEvidence', @@ROWCOUNT);
    UPDATE wf.RebateEvidenceDiscoveryCursor SET EnvironmentKind = 'uat'
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateEvidenceDiscoveryCursor', @@ROWCOUNT);
    UPDATE wf.RebateShipmentAccrual SET EnvironmentKind = 'uat'
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateShipmentAccrual', @@ROWCOUNT);
    UPDATE wf.RebateConversionApprovalRequest SET EnvironmentKind = 'uat'
      WHERE EnvironmentKind = 'production';                                   INSERT @n VALUES ('RebateConversionApprovalRequest', @@ROWCOUNT);

    ALTER TABLE wf.RebateResetAttemptTarget WITH CHECK CHECK CONSTRAINT FK_RebateResetAttemptTarget_Attempt;
    ALTER TABLE wf.RebateResetClaimCancellation WITH CHECK CHECK CONSTRAINT FK_RebateResetClaimCancellation_Receipt;
    IF @accruals > 0 ENABLE TRIGGER wf.trg_RebateShipmentAccrual_Verified ON wf.RebateShipmentAccrual;

    -- Nothing labelled production may remain, and the state must now match UAT's manifest.
    IF EXISTS (SELECT 1 FROM wf.RebateResetCoordinator WHERE EnvironmentKind = 'production')
       OR EXISTS (SELECT 1 FROM wf.RebateResetParticipant WHERE EnvironmentKind = 'production')
       OR EXISTS (SELECT 1 FROM wf.RebateShipmentEvidence WHERE EnvironmentKind = 'production')
       OR EXISTS (SELECT 1 FROM wf.RebateShipmentAccrual WHERE EnvironmentKind = 'production')
       OR NOT EXISTS (SELECT 1 FROM wf.RebateResetCoordinator c JOIN wf.RebateResetParticipant p ON p.EnvironmentKind = c.EnvironmentKind
                      WHERE c.EnvironmentKind = 'uat' AND c.PrimaryDatabase = 'dbwins_worldfert9_uat' AND c.ManifestDigest = @digest
                        AND p.ManifestDigest = @digest AND p.Generation = c.Generation AND ISNULL(CAST(p.ResetId AS varchar(36)), '') = ISNULL(CAST(c.ResetId AS varchar(36)), ''))
        RAISERROR('UAT_ADOPT_VERIFY_FAILED', 16, 1);
    IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'trg_RebateShipmentAccrual_Verified' AND is_disabled = 1)
        RAISERROR('UAT_ADOPT_TRIGGER_LEFT_DISABLED', 16, 1);
    SELECT 'UAT_ADOPT_DONE' AS Result, TableName, RowsChanged FROM @n;
END
GO
COMMIT TRAN;
GO
