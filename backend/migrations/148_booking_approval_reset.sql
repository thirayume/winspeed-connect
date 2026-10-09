-- ============================================================================
-- 148_booking_approval_reset.sql
-- WinSpeed approval of a booking (103): void it after a material edit, and take a
-- booking cancelled in the app out of WinSpeed's approval queue.
--
-- Background (owner decision 2026-10-09, UAT full loop):
-- - A change in goods, tons or price after an unlock must be approved again in WinSpeed
--   (the old approval AI69-06841 stood on a bill raised from 1 t to 2 t). The approval
--   lives on dbo.SOHD: AppvFlag 'Y', Appvid, AppvDate, AppvDocuNo 'AI69-…'.
-- - The app login has no UPDATE on SOHD.AppvFlag ("UPDATE permission was denied on the
--   column 'AppvFlag'"), so the reset goes through a wf procedure (ownership chaining:
--   wf and dbo are both owned by dbo; the app holds EXECUTE on schema wf).
-- - A booking cancelled in the app gets DocuStatus 'C', a value WinSpeed never uses on
--   103 (its bookings are 'N' open / 'Y' closed), so WinSpeed's "อนุมัติใบสั่งจอง (WF)"
--   lookup still offered it (I69-04235). Marking it AppvFlag 'N' (not approved) takes it
--   out of the queue.
--
-- SQL 2008 R2: CREATE stub + ALTER, no THROW; wf schema only, no dbo structure change.
-- ============================================================================

IF OBJECT_ID('wf.usp_ResetBookingApproval', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.usp_ResetBookingApproval AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_ResetBookingApproval
    @SOID INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Voided NVARCHAR(255);
    SELECT @Voided = AppvDocuNo FROM dbo.SOHD
    WHERE SOID = @SOID AND DocuType = 103 AND (AppvFlag = 'Y' OR AppvDocuNo IS NOT NULL);

    UPDATE dbo.SOHD
    SET AppvFlag = 'W', AppvDocuNo = NULL, Appvid = NULL, AppvDate = NULL
    WHERE SOID = @SOID AND DocuType = 103 AND (AppvFlag = 'Y' OR AppvDocuNo IS NOT NULL);

    SELECT @@ROWCOUNT AS Affected, @Voided AS VoidedDocuNo;
END
GO

IF OBJECT_ID('wf.usp_MarkCancelledBookingNotApproved', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.usp_MarkCancelledBookingNotApproved AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_MarkCancelledBookingNotApproved
    @SOID INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SOHD
    SET AppvFlag = 'N'
    WHERE SOID = @SOID AND DocuType = 103 AND DocuStatus = 'C'
      AND AppvFlag = 'W' AND AppvDocuNo IS NULL;
    SELECT @@ROWCOUNT AS Affected;
END
GO
