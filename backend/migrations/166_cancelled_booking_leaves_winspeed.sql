-- @transaction
-- UAT round trip (3 November 2026): a booking cancelled in the app after WINSpeed approved it stayed in the
-- lookup ใบสั่งขาย (WF) uses to issue a 104, so a sale could be issued from a cancelled bill. Migration 148
-- closed this only for a booking still waiting for approval. The approved booking with no 104 yet now gets
-- AppvFlag 'N' too; a booking with a live 104 is never touched. wf schema only, no dbo structure change.
-- SQL Server 2008 compatible; idempotent.
IF OBJECT_ID('wf.usp_MarkCancelledBookingNotApproved','P') IS NULL
 RAISERROR('CBL_PREREQUISITE_REQUIRED',16,1);
GO
ALTER PROCEDURE wf.usp_MarkCancelledBookingNotApproved
    @SOID INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE b
    SET AppvFlag = 'N'
    FROM dbo.SOHD b
    WHERE b.SOID = @SOID AND b.DocuType = 103 AND b.DocuStatus = 'C'
      AND ((b.AppvFlag = 'W' AND b.AppvDocuNo IS NULL)
           OR (b.AppvFlag = 'Y' AND NOT EXISTS (
                 SELECT 1 FROM dbo.SOHD d
                 WHERE d.DocuType = 104 AND d.RefNo = b.AppvDocuNo AND ISNULL(d.DocuStatus, '') <> 'C')));
    SELECT @@ROWCOUNT AS Affected;
END
GO
