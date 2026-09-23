const { query, sql, runWithTarget, closeAll } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    try {
      console.log('--- Testing PENDING tab SQL Pagination ---');
      const pendingSql = `
        WITH Items AS (
          SELECT
            NULL AS CouponID,
            NULL AS CouponNo,
            h.DocuNo,
            h.DocuDate,
            h.SOID,
            dt.ListNo AS ListNo,
            CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12, 3)) AS TotalQtyTon
          FROM dbo.SOHD h WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = h.SOID
          WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' 
            AND h.AppvFlag = 'Y'
            AND NOT EXISTS (
              SELECT 1 FROM dbo.SODT d104 WITH (NOLOCK)
              JOIN dbo.SOHD h104 WITH (NOLOCK) ON h104.SOID = d104.SOID AND h104.DocuType = 104
              WHERE d104.RefSOID = h.SOID AND h104.DocuStatus <> 'C'
            )
        )
        SELECT * FROM (
          SELECT 
            *,
            COUNT(*) OVER() AS TotalFilteredCount
          FROM Items
        ) raw
        ORDER BY
          DocuDate DESC,
          DocuNo DESC,
          ISNULL(CouponID, 0) DESC,
          ISNULL(SOID, 0) DESC,
          ISNULL(ListNo, 0) ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `;

      const t0 = Date.now();
      const p1 = await query(pendingSql, {
        offset: { type: sql.Int, value: 0 },
        limit: { type: sql.Int, value: 5 }
      });
      const t1 = Date.now();
      console.log(`Pending Page 1 in ${t1 - t0}ms, returned: ${p1.length}`);
      if (p1.length > 0) {
        console.log(`Pending Total Count: ${p1[0].TotalFilteredCount}`);
        console.table(p1);
      }

      console.log('\n--- Testing HISTORY tab SQL Pagination ---');
      const historySql = `
        WITH Items AS (
          SELECT 
            c.CouponID,
            c.CouponNo,
            c.CouponNo AS DocuNo,
            h104.DocuDate,
            ISNULL(h103.SOID, h104.SOID) AS SOID,
            c.RefListno AS ListNo,
            c.RemaQty AS NativeRemainingQtyTon
          FROM dbo.WFCoupon c WITH (NOLOCK)
          JOIN dbo.SOHD h104 WITH (NOLOCK) ON h104.SOID = c.DocuID AND h104.DocuType = 104
          LEFT JOIN dbo.SODT d104 WITH (NOLOCK) ON d104.SOID = c.DocuID AND d104.ListNo = c.RefListno
          LEFT JOIN dbo.SOHD h103 WITH (NOLOCK) ON h103.SOID = d104.RefSOID AND h103.DocuType = 103
          WHERE c.RemaQty <= 0 OR h104.DocuStatus = 'C'
        )
        SELECT * FROM (
          SELECT 
            *,
            COUNT(*) OVER() AS TotalFilteredCount
          FROM Items
        ) raw
        ORDER BY
          DocuDate DESC,
          DocuNo DESC,
          ISNULL(CouponID, 0) DESC,
          ISNULL(SOID, 0) DESC,
          ISNULL(ListNo, 0) ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `;
      const t2 = Date.now();
      const h1 = await query(historySql, {
        offset: { type: sql.Int, value: 0 },
        limit: { type: sql.Int, value: 5 }
      });
      const t3 = Date.now();
      console.log(`History Page 1 in ${t3 - t2}ms, returned: ${h1.length}`);
      if (h1.length > 0) {
        console.log(`History Total Count: ${h1[0].TotalFilteredCount}`);
        console.table(h1);
      }

    } catch (err) {
      console.error('Error:', err);
    }
  });
  await closeAll();
}

main();
