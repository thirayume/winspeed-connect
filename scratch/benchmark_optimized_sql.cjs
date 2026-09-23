'use strict';
const db = require('../backend/db');

const optimizedSql = `WITH InvoicedLines AS (
  -- 1. Direct invoice lines (enforcing DocuType IN (107, 202))
  SELECT 
    d.SOID AS SOID,
    d.ListNo AS SOListNo,
    idt.SOInvID,
    idt.ListNo AS InvListNo,
    idt.GoodAmnt AS InvoicedAmnt
  FROM dbo.SODT d WITH (NOLOCK)
  JOIN dbo.SOInvDT idt WITH (NOLOCK) ON idt.RefID = d.SOID AND idt.RefListNo = d.ListNo
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'

  UNION

  -- 2. Delivery Order (104) invoice lines (enforcing DocuType IN (107, 202))
  SELECT 
    d.SOID AS SOID,
    d.ListNo AS SOListNo,
    idt104.SOInvID,
    idt104.ListNo AS InvListNo,
    idt104.GoodAmnt AS InvoicedAmnt
  FROM dbo.SODT d WITH (NOLOCK)
  JOIN dbo.SODT dt104 WITH (NOLOCK) ON dt104.RefSOID = d.SOID AND dt104.RefListNo = d.ListNo
  JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = dt104.SOID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
  JOIN dbo.SOInvDT idt104 WITH (NOLOCK) ON idt104.RefID = dt104.SOID AND idt104.RefListNo = dt104.ListNo
  JOIN dbo.SOInvHD ih104 WITH (NOLOCK) ON ih104.SOInvID = idt104.SOInvID AND ih104.DocuType IN (107, 202) AND ih104.DocuStatus <> 'C'
),
UnallocatedInvoices AS (
  -- Branch 1: Direct invoice lines referencing SOID with missing or unmapped RefListNo
  SELECT 
    ih.SOInvID,
    idt.ListNo AS InvListNo,
    idt.RefID AS SOID,
    idt.GoodAmnt AS UnallocatedAmnt
  FROM dbo.SOInvDT idt WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
  JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = idt.RefID AND h.DocuType = 103
  WHERE idt.RefListNo IS NULL
     OR NOT EXISTS (SELECT 1 FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = idt.RefID AND d.ListNo = idt.RefListNo)

  UNION

  -- Branch 2: Delivery 104 invoice lines where RefListNo is missing or does not map to SODT (104)
  SELECT 
    ih.SOInvID,
    idt.ListNo AS InvListNo,
    COALESCE(dt104_exact.RefSOID, dt104_any.RefSOID) AS SOID,
    idt.GoodAmnt AS UnallocatedAmnt
  FROM dbo.SOInvDT idt WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
  JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = idt.RefID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
  LEFT JOIN dbo.SODT dt104_exact WITH (NOLOCK) ON dt104_exact.SOID = idt.RefID AND dt104_exact.ListNo = idt.RefListNo
  LEFT JOIN (
    SELECT DISTINCT SOID AS DeliverySOID, RefSOID
    FROM dbo.SODT WITH (NOLOCK)
    WHERE RefSOID IS NOT NULL
  ) dt104_any ON dt104_any.DeliverySOID = hd104.SOID
  WHERE idt.RefListNo IS NULL
     OR dt104_exact.RefSOID IS NULL
     OR dt104_exact.RefListNo IS NULL
     OR NOT EXISTS (SELECT 1 FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = dt104_exact.RefSOID AND d.ListNo = dt104_exact.RefListNo)

  UNION

  -- Branch 3: Line does NOT have a valid line-level RefID, but invoice header ih.RefSOID points to SO 103 (R5-01 partial same-invoice unreferenced line)
  SELECT 
    ih.SOInvID,
    idt.ListNo AS InvListNo,
    ih.RefSOID AS SOID,
    idt.GoodAmnt AS UnallocatedAmnt
  FROM dbo.SOInvDT idt WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
  JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = ih.RefSOID AND h.DocuType = 103 AND h.DocuStatus <> 'C'
  WHERE (idt.RefID IS NULL OR idt.RefID <> ih.RefSOID)
    AND NOT EXISTS (
      SELECT 1 FROM dbo.SODT dt104 WITH (NOLOCK)
      JOIN dbo.SODT d WITH (NOLOCK) ON d.SOID = dt104.RefSOID AND d.ListNo = dt104.RefListNo
      WHERE dt104.SOID = idt.RefID AND dt104.ListNo = idt.RefListNo AND dt104.RefSOID = ih.RefSOID
    )

  UNION

  -- Branch 4: Line does NOT have a valid line-level RefID, but invoice header ih.RefSOID points to Delivery 104
  SELECT 
    ih.SOInvID,
    idt.ListNo AS InvListNo,
    dt104_any.RefSOID AS SOID,
    idt.GoodAmnt AS UnallocatedAmnt
  FROM dbo.SOInvDT idt WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
  JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = ih.RefSOID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
  JOIN (
    SELECT DISTINCT SOID AS DeliverySOID, RefSOID
    FROM dbo.SODT WITH (NOLOCK)
    WHERE RefSOID IS NOT NULL
  ) dt104_any ON dt104_any.DeliverySOID = hd104.SOID
  WHERE (idt.RefID IS NULL OR idt.RefID <> hd104.SOID)
    AND NOT EXISTS (
      SELECT 1 FROM dbo.SODT d WITH (NOLOCK)
      WHERE d.SOID = dt104_any.RefSOID AND d.SOID = idt.RefID AND d.ListNo = idt.RefListNo
    )

  UNION

  -- Branch 5: Genuine header-only invoice without ANY lines in SOInvDT (direct to SO 103)
  SELECT 
    ih.SOInvID,
    0 AS InvListNo,
    ih.RefSOID AS SOID,
    CAST(0 AS decimal(12,2)) AS UnallocatedAmnt
  FROM dbo.SOInvHD ih WITH (NOLOCK)
  JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = ih.RefSOID AND h.DocuType = 103 AND h.DocuStatus <> 'C'
  WHERE ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
    AND NOT EXISTS (
      SELECT 1 FROM dbo.SOInvDT idt WITH (NOLOCK) WHERE idt.SOInvID = ih.SOInvID
    )

  UNION

  -- Branch 6: Genuine header-only invoice without ANY lines in SOInvDT (via Delivery 104)
  SELECT 
    ih.SOInvID,
    0 AS InvListNo,
    dt104_any.RefSOID AS SOID,
    CAST(0 AS decimal(12,2)) AS UnallocatedAmnt
  FROM dbo.SOInvHD ih WITH (NOLOCK)
  JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = ih.RefSOID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
  JOIN (
    SELECT DISTINCT SOID AS DeliverySOID, RefSOID
    FROM dbo.SODT WITH (NOLOCK)
    WHERE RefSOID IS NOT NULL
  ) dt104_any ON dt104_any.DeliverySOID = hd104.SOID
  WHERE ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
    AND NOT EXISTS (
      SELECT 1 FROM dbo.SOInvDT idt WITH (NOLOCK) WHERE idt.SOInvID = ih.SOInvID
    )
),
UnallocatedBySO AS (
  SELECT SOID, COUNT_BIG(*) AS UnallocatedCnt, SUM(UnallocatedAmnt) AS UnallocatedTotalAmnt
  FROM (
    SELECT DISTINCT SOID, SOInvID, InvListNo, UnallocatedAmnt
    FROM UnallocatedInvoices
  ) u
  GROUP BY SOID
),
DedupedInvoicedLines AS (
  SELECT SOID, SOListNo, SUM(InvoicedAmnt) AS TotalLineInvoicedAmnt
  FROM (
    SELECT DISTINCT SOID, SOListNo, SOInvID, InvListNo, InvoicedAmnt
    FROM InvoicedLines
  ) sub
  GROUP BY SOID, SOListNo
),
SOBalances AS (
  SELECT 
    h.SOID,
    h.DocuNo,
    CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
    h.CustName,
    SUM(d.GoodAmnt) AS TotalOrderAmnt,
    SUM(ISNULL(inv.TotalLineInvoicedAmnt, 0)) AS TotalInvoicedAmnt,
    SUM(d.GoodAmnt) - SUM(ISNULL(inv.TotalLineInvoicedAmnt, 0)) AS OutstandingAmnt,
    ISNULL(u.UnallocatedCnt, 0) AS UnallocatedCount,
    ISNULL(u.UnallocatedTotalAmnt, 0) AS UnallocatedTotalAmnt
  FROM dbo.SOHD h WITH (NOLOCK)
  JOIN dbo.SODT d WITH (NOLOCK) ON d.SOID = h.SOID
  LEFT JOIN DedupedInvoicedLines inv ON inv.SOID = d.SOID AND inv.SOListNo = d.ListNo
  LEFT JOIN UnallocatedBySO u ON u.SOID = h.SOID
  WHERE h.DocuType = 103 AND h.DocuStatus <> 'C'
  GROUP BY h.SOID, h.DocuNo, h.DocuDate, h.CustName, u.UnallocatedCnt, u.UnallocatedTotalAmnt
)
SELECT TOP 200
  DocuNo,
  DocuDate,
  CustName,
  CASE
    WHEN UnallocatedCount > 0 THEN NULL
    ELSE CAST(OutstandingAmnt AS DECIMAL(12,2))
  END AS EstimatedAmount,
  CASE
    WHEN UnallocatedCount > 0 THEN 'UNKNOWN'
    WHEN OutstandingAmnt < -0.009 THEN 'OVER_INVOICED'
    ELSE 'NORMAL'
  END AS AllocationStatus,
  CASE
    WHEN UnallocatedCount > 0 THEN N'พบรายการใบกำกับที่ไม่สามารถระบุรายการสั่งซื้อได้ (UNKNOWN Allocation)'
    WHEN OutstandingAmnt < -0.009 THEN N'ออกใบกำกับเกินยอดสั่งซื้อ (Over-invoiced exception)'
    ELSE N'ประมาณการยอดขายค้างออกใบกำกับ (ไม่ใช่หลักฐาน GL)'
  END AS Note,
  CAST(SOID AS VARCHAR(50)) AS RefSO
FROM SOBalances
WHERE (OutstandingAmnt >= 0.01 OR OutstandingAmnt < -0.009 OR UnallocatedCount > 0)
ORDER BY DocuDate DESC, SOID DESC`;

(async () => {
  try {
    await db.runWithTarget('remote_b', async () => {
      console.log('Testing index-seek optimized SQL on remote_b...');
      const t0 = Date.now();
      const res = (await db.wfQuery(optimizedSql)).recordset;
      const elapsed = Date.now() - t0;
      console.log(`Query returned ${res.length} rows in ${elapsed} ms`);
    });
  } finally {
    await Promise.allSettled([db.readerReady, db.ownerReady]);
    const pl = db.runWithTarget('remote_b', () => db.pools());
    await Promise.allSettled([db.readerPool.close(), db.ownerPool.close(), pl.readerPool.close(), pl.ownerPool.close()]);
  }
})();
