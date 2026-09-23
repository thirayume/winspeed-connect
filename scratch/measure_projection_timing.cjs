'use strict';
const db = require('../backend/db');

(async () => {
  try {
    await db.runWithTarget('remote_b', async () => {
      console.log('Testing query performance on remote_b (dbwins_worldfert9_test_v2)...');
      
      const t0 = Date.now();
      // Test 1: InvoicedLines alone
      console.log('Timing InvoicedLines CTE alone...');
      const q1 = `
        WITH InvoicedLines AS (
          SELECT d.SOID AS SOID, d.ListNo AS SOListNo, idt.SOInvID, idt.ListNo AS InvListNo, idt.GoodAmnt AS InvoicedAmnt
          FROM dbo.SODT d WITH (NOLOCK)
          JOIN dbo.SOInvDT idt WITH (NOLOCK) ON idt.RefID = d.SOID AND idt.RefListNo = d.ListNo
          JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
          UNION
          SELECT d.SOID AS SOID, d.ListNo AS SOListNo, idt104.SOInvID, idt104.ListNo AS InvListNo, idt104.GoodAmnt AS InvoicedAmnt
          FROM dbo.SODT d WITH (NOLOCK)
          JOIN dbo.SODT dt104 WITH (NOLOCK) ON dt104.RefSOID = d.SOID AND dt104.RefListNo = d.ListNo
          JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = dt104.SOID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
          JOIN dbo.SOInvDT idt104 WITH (NOLOCK) ON idt104.RefID = dt104.SOID AND idt104.RefListNo = dt104.ListNo
          JOIN dbo.SOInvHD ih104 WITH (NOLOCK) ON ih104.SOInvID = idt104.SOInvID AND ih104.DocuType IN (107, 202) AND ih104.DocuStatus <> 'C'
        )
        SELECT COUNT(*) AS Cnt FROM InvoicedLines;
      `;
      const r1 = await db.wfQuery(q1);
      console.log(`InvoicedLines: ${r1.recordset[0].Cnt} rows in ${Date.now() - t0} ms`);

      // Test 2: UnallocatedInvoices alone
      const t1 = Date.now();
      console.log('Timing UnallocatedInvoices CTE Branches 1 & 2...');
      const q2 = `
        SELECT COUNT(*) AS Cnt
        FROM dbo.SOInvDT idt WITH (NOLOCK)
        JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
        JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = idt.RefID AND h.DocuType = 103
        WHERE idt.RefListNo IS NULL
           OR NOT EXISTS (SELECT 1 FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = idt.RefID AND d.ListNo = idt.RefListNo);
      `;
      const r2 = await db.wfQuery(q2);
      console.log(`UnallocatedInvoices Branch 1: ${r2.recordset[0].Cnt} rows in ${Date.now() - t1} ms`);

      const t2 = Date.now();
      console.log('Timing UnallocatedInvoices Branch 2...');
      const q3 = `
        SELECT COUNT(*) AS Cnt
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
           OR NOT EXISTS (SELECT 1 FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = dt104_exact.RefSOID AND d.ListNo = dt104_exact.RefListNo);
      `;
      const r3 = await db.wfQuery(q3);
      console.log(`UnallocatedInvoices Branch 2: ${r3.recordset[0].Cnt} rows in ${Date.now() - t2} ms`);

      const t3 = Date.now();
      console.log('Timing the FULL production projection SQL as defined in reports.js...');
      const fullSql = require('../backend/routes/reports').REPORTS['so-sales-billing-projection'].sql;
      const fullRes = await db.wfQuery(fullSql);
      console.log(`FULL SQL returned ${fullRes.recordset.length} rows in ${Date.now() - t3} ms`);
    });
  } catch (err) {
    console.error('Error during performance measurement:', err);
  } finally {
    await Promise.allSettled([db.readerReady, db.ownerReady]);
    const pl = db.runWithTarget('remote_b', () => db.pools());
    await Promise.allSettled([db.readerPool.close(), db.ownerPool.close(), pl.readerPool.close(), pl.ownerPool.close()]);
  }
})();
