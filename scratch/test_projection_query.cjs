const { runWithTarget, wfQuery } = require('../backend/db');

async function testQuery() {
  await runWithTarget('remote_b', async () => {
    const projSql = `
      WITH InvoicedLines AS (
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

        SELECT 
          ih.SOInvID,
          idt.ListNo AS InvListNo,
          dt104.RefSOID AS SOID,
          idt.GoodAmnt AS UnallocatedAmnt
        FROM dbo.SOInvDT idt WITH (NOLOCK)
        JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
        JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = idt.RefID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
        LEFT JOIN dbo.SODT dt104 WITH (NOLOCK) ON dt104.SOID = idt.RefID AND dt104.ListNo = idt.RefListNo
        WHERE idt.RefListNo IS NULL
           OR dt104.RefSOID IS NULL
           OR dt104.RefListNo IS NULL
           OR NOT EXISTS (SELECT 1 FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = dt104.RefSOID AND d.ListNo = dt104.RefListNo)
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
        CAST(OutstandingAmnt AS DECIMAL(12,2)) AS EstimatedAmount,
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
      ORDER BY DocuDate DESC, SOID DESC
    `;

    console.log('Running test query with chronological order...');
    const t0 = Date.now();
    const res = await wfQuery(projSql);
    const duration = Date.now() - t0;
    console.log(`Query completed in ${duration} ms, rows: ${res.recordset.length}`);
    if (res.recordset.length > 0) {
      console.log('Sample row 0:', res.recordset[0]);
      const statusCounts = {};
      for (const r of res.recordset) {
        statusCounts[r.AllocationStatus] = (statusCounts[r.AllocationStatus] || 0) + 1;
      }
      console.log('AllocationStatus distribution:', statusCounts);
    }
  });
}

testQuery().catch(err => {
  console.error('Query failed:', err);
  process.exit(1);
});
