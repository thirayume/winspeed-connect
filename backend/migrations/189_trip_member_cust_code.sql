-- ============================================================================
-- Migration 189: Expose CustCode on wf.v_TripMember for Same-Customer Prefix Grouping
-- - Groups branch/sub-accounts sharing the customer code prefix before "-"
--   (e.g. "0462002" and "0462002-1") as the same customer in Sale Trips
-- - Uses pure SQL Server 2008 R2+ compatible syntax (IF OBJECT_ID + ALTER VIEW)
-- ============================================================================

IF OBJECT_ID('wf.v_TripMember', 'V') IS NULL
  EXEC('CREATE VIEW wf.v_TripMember AS SELECT 1 AS dummy');
GO

ALTER VIEW wf.v_TripMember
AS
SELECT
    o.TripId,
    'DRAFT'                      AS MemberKind,
    CAST(o.Id AS VARCHAR(50))    AS MemberId,
    o.WfRef                      AS DocuNo,
    o.SoPrefix,
    o.CustId,
    RTRIM(co.CustCode)           AS CustCode,
    o.CustName,
    o.Status,
    o.DeliveryDate,
    o.SalesUserId,
    CAST(NULL AS INT)            AS SOID
FROM   wf.SalesOrder o
LEFT   JOIN dbo.EMCust co
  ON   co.CustID = CASE
         WHEN o.CustId IS NOT NULL
          AND LTRIM(RTRIM(o.CustId)) <> ''
          AND LTRIM(RTRIM(o.CustId)) NOT LIKE '%[^0-9]%'
          AND LEN(LTRIM(RTRIM(o.CustId))) <= 9
         THEN CAST(LTRIM(RTRIM(o.CustId)) AS INT)
         ELSE NULL
       END
WHERE  o.TripId IS NOT NULL
UNION ALL
SELECT
    e.TripId,
    'CONFIRMED'                  AS MemberKind,
    e.SOID                       AS MemberId,
    RTRIM(s.DocuNo)              AS DocuNo,
    e.SoPrefix,
    CAST(s.CustID AS VARCHAR(50)) AS CustId,
    RTRIM(c.CustCode)            AS CustCode,
    RTRIM(c.CustName)            AS CustName,
    CASE WHEN s.AppvFlag = 'W' AND s.AppvDocuNo IS NULL THEN 'PENDING_APPROVAL'
         ELSE 'CONFIRMED' END    AS Status,
    e.DeliveryDate,
    e.SalesUserId,
    CASE
      WHEN e.SOID IS NOT NULL
       AND LTRIM(RTRIM(e.SOID)) <> ''
       AND LTRIM(RTRIM(e.SOID)) NOT LIKE '%[^0-9]%'
       AND LEN(LTRIM(RTRIM(e.SOID))) <= 9
      THEN CAST(LTRIM(RTRIM(e.SOID)) AS INT)
      ELSE NULL
    END                          AS SOID
FROM   wf.SalesOrderExt e
LEFT   JOIN dbo.SOHD s
  ON   s.SOID = CASE
         WHEN e.SOID IS NOT NULL
          AND LTRIM(RTRIM(e.SOID)) <> ''
          AND LTRIM(RTRIM(e.SOID)) NOT LIKE '%[^0-9]%'
          AND LEN(LTRIM(RTRIM(e.SOID))) <= 9
         THEN CAST(LTRIM(RTRIM(e.SOID)) AS INT)
         ELSE NULL
       END
   AND s.DocuType = 103
LEFT   JOIN dbo.EMCust c ON c.CustID = s.CustID
WHERE  e.TripId IS NOT NULL;
GO
