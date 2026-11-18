/* Read-only investigation on R740 UAT. SQL Server 2008 R2 compatible.
   Result 1: customers whose 103 bookings include both I and K.
   Result 2: their 103 and 104 documents in the same date range.
   Historical document prefixes do not establish a customer's account policy.
   Cancelled documents are included and labelled for review. */
SET NOCOUNT ON;

IF DB_NAME() <> N'dbwins_worldfert9_uat'
BEGIN
    RAISERROR(N'Connect to dbwins_worldfert9_uat before running this report.', 16, 1);
    RETURN;
END;

DECLARE @StartDate datetime = '20260101';
-- Exclusive upper bound; NULL includes every date from @StartDate onward.
DECLARE @EndDateExclusive datetime = NULL;

IF OBJECT_ID('tempdb..#CustomersBothBooks') IS NOT NULL DROP TABLE #CustomersBothBooks;

SELECT h.CustID,
       SUM(CASE WHEN LEFT(LTRIM(h.DocuNo), 1) = 'I' THEN 1 ELSE 0 END) AS BookingI,
       SUM(CASE WHEN LEFT(LTRIM(h.DocuNo), 1) = 'K' THEN 1 ELSE 0 END) AS BookingK
INTO #CustomersBothBooks
FROM dbo.SOHD h
WHERE h.DocuType = 103
  AND h.CustID IS NOT NULL
  AND h.DocuDate >= @StartDate
  AND (@EndDateExclusive IS NULL OR h.DocuDate < @EndDateExclusive)
  AND LEFT(LTRIM(h.DocuNo), 1) IN ('I', 'K')
GROUP BY h.CustID
HAVING SUM(CASE WHEN LEFT(LTRIM(h.DocuNo), 1) = 'I' THEN 1 ELSE 0 END) > 0
   AND SUM(CASE WHEN LEFT(LTRIM(h.DocuNo), 1) = 'K' THEN 1 ELSE 0 END) > 0;

SELECT b.CustID, c.CustCode, c.CustName, b.BookingI, b.BookingK
FROM #CustomersBothBooks b
LEFT JOIN dbo.EMCust c ON c.CustID = b.CustID
ORDER BY c.CustCode, b.CustID;

SELECT b.CustID, c.CustCode, c.CustName,
       h.SOID, h.DocuType,
       CASE h.DocuType WHEN 103 THEN N'ใบสั่งจอง' WHEN 104 THEN N'ใบสั่งขาย' END AS DocumentType,
       LEFT(LTRIM(h.DocuNo), 1) AS AccountBook,
       h.DocuNo, h.DocuDate, h.DocuStatus,
       CASE WHEN h.DocuStatus = 'C' THEN N'ยกเลิก' ELSE N'ตรวจสถานะใน WinSpeed' END AS StatusNote
FROM #CustomersBothBooks b
JOIN dbo.SOHD h ON h.CustID = b.CustID
LEFT JOIN dbo.EMCust c ON c.CustID = b.CustID
WHERE h.DocuType IN (103, 104)
  AND h.DocuDate >= @StartDate
  AND (@EndDateExclusive IS NULL OR h.DocuDate < @EndDateExclusive)
  AND LEFT(LTRIM(h.DocuNo), 1) IN ('I', 'K')
ORDER BY c.CustCode, b.CustID, h.DocuDate, h.DocuType, h.SOID;

DROP TABLE #CustomersBothBooks;
