-- ============================================================================
-- 151_quotation_cancel_leaves_winspeed_queue.sql
-- A quotation cancelled in the app leaves WinSpeed's quotation approval lookup.
--
-- Background (UAT 2026-10-09, owner WinSpeed check): wf.sp_QuotationCancelNative set the QU
-- (dbo.SOHD DocuType 102) to DocuStatus 'C', but WinSpeed's "อนุมัติใบเสนอราคา" lookup
-- (อ้างถึง Quotation) still offered the cancelled QU6910-00004. Its query, read from the plan
-- cache, keeps a QU while
--     ISNULL(OnHold,'N') = 'N' AND ISNULL(ClearSO,'N') = 'N' AND ISNULL(DocuStatus,'N') <> 'Y'
-- so neither DocuStatus 'C' nor AppvFlag takes it out. Closing it (ClearSO 'Y', ClearDate) does,
-- and AppvFlag 'N' records that it was never approved. An approved QU (with its QC) is untouched.
--
-- The procedure is changed in place (ownership chaining: the app login has no UPDATE on
-- dbo.SOHD). Quotations already cancelled are closed once, also through a wf procedure because
-- the migration login has no UPDATE on dbo.SOHD either.
-- SQL 2008 R2: ALTER only, no THROW; wf schema only, no dbo structure change.
-- ============================================================================

IF OBJECT_ID('wf.sp_QuotationCancelNative', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationCancelNative AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationCancelNative
    @QuoteSOID INT,
    @ConfirmSOID INT = NULL,
    @Remark NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SOHD
    SET DocuStatus = 'C',
        StatusRemark = @Remark,
        ClearSO = 'Y',
        ClearDate = CONVERT(DATETIME, CONVERT(CHAR(8), GETDATE(), 112)),
        AppvFlag = CASE WHEN AppvFlag = 'W' AND AppvDocuNo IS NULL THEN 'N' ELSE AppvFlag END
    WHERE SOID = @QuoteSOID AND DocuType = '102';

    UPDATE dbo.SOHD
    SET DocuStatus = 'C',
        StatusRemark = @Remark
    WHERE @ConfirmSOID IS NOT NULL AND SOID = @ConfirmSOID AND DocuType = '113';
END
GO

-- quotations cancelled before this migration
IF OBJECT_ID('wf.usp_CloseCancelledQuotations', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.usp_CloseCancelledQuotations AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_CloseCancelledQuotations
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SOHD
    SET ClearSO = 'Y',
        ClearDate = ISNULL(ClearDate, CONVERT(DATETIME, CONVERT(CHAR(8), GETDATE(), 112))),
        AppvFlag = CASE WHEN AppvFlag = 'W' AND AppvDocuNo IS NULL THEN 'N' ELSE AppvFlag END
    WHERE DocuType = '102' AND DocuStatus = 'C' AND ISNULL(ClearSO, 'N') = 'N';
    SELECT @@ROWCOUNT AS Affected;
END
GO

EXEC wf.usp_CloseCancelledQuotations;
GO
