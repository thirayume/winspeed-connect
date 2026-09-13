const { runWithTarget, query, sql } = require('../backend/db');

runWithTarget('remote_b', async () => {
  try {
    const maxRes = await query(`SELECT MAX(CAST(SetPriceID AS INT)) as MaxId FROM dbo.EMSetPriceHD`);
    const nextId1 = Number(maxRes[0].MaxId) + 1;
    const nextId2 = nextId1 + 1;
    console.log(`Creating SetPrice ${nextId1} and ${nextId2} for 2026-09-01 to 2026-09-30...`);

    // 1. Insert HD 1
    await query(`
      INSERT INTO dbo.EMSetPriceHD (
        SetPriceID, DocuType, BrchID, DocuNo, DocuDate, BeginDate, EndDate, CustID,
        SetPriceFlag, CustFlag, GoodFlag, DocuFlag, PromotionFlag, GoldenTimeFlag,
        PriceOption, BeginTime, EndTime, ChangedDate
      ) VALUES (
        @id, '751', '1', 'SPL6909-00001', '2026-09-01', '2026-09-01', '2026-09-30', NULL,
        'Y', 'A', 'C', 'Y', 'N', 'N',
        '1', '0000', '0000', GETDATE()
      )
    `, { id: { type: sql.Int, value: nextId1 } });

    // Copy DT from 2062
    await query(`
      INSERT INTO dbo.EMSetPriceDT (
        SetPriceID, ListNo, ListID, GoodPriceNet, startgoodqty, endgoodqty,
        ListFlag, EditFlag
      )
      SELECT @newId, ListNo, ListID, GoodPriceNet, startgoodqty, endgoodqty,
             ListFlag, EditFlag
      FROM dbo.EMSetPriceDT
      WHERE SetPriceID = 2062
    `, { newId: { type: sql.Int, value: nextId1 } });

    // 2. Insert HD 2
    await query(`
      INSERT INTO dbo.EMSetPriceHD (
        SetPriceID, DocuType, BrchID, DocuNo, DocuDate, BeginDate, EndDate, CustID,
        SetPriceFlag, CustFlag, GoodFlag, DocuFlag, PromotionFlag, GoldenTimeFlag,
        PriceOption, BeginTime, EndTime, ChangedDate
      ) VALUES (
        @id, '751', '1', 'SPL6909-00002', '2026-09-01', '2026-09-01', '2026-09-30', NULL,
        'Y', 'A', 'C', 'Y', 'N', 'N',
        '1', '0000', '0000', GETDATE()
      )
    `, { id: { type: sql.Int, value: nextId2 } });

    // Copy DT from 2063
    await query(`
      INSERT INTO dbo.EMSetPriceDT (
        SetPriceID, ListNo, ListID, GoodPriceNet, startgoodqty, endgoodqty,
        ListFlag, EditFlag
      )
      SELECT @newId, ListNo, ListID, GoodPriceNet, startgoodqty, endgoodqty,
             ListFlag, EditFlag
      FROM dbo.EMSetPriceDT
      WHERE SetPriceID = 2063
    `, { newId: { type: sql.Int, value: nextId2 } });

    // Verify active prices for 2026-09-07
    const check = await query(`
      SELECT hd.SetPriceID, hd.DocuNo, hd.BeginDate, hd.EndDate, COUNT(dt.ListNo) as LineCount
      FROM dbo.EMSetPriceHD hd
      JOIN dbo.EMSetPriceDT dt ON dt.SetPriceID = hd.SetPriceID
      WHERE hd.BeginDate <= '2026-09-07' AND (hd.EndDate IS NULL OR hd.EndDate >= '2026-09-07')
      GROUP BY hd.SetPriceID, hd.DocuNo, hd.BeginDate, hd.EndDate
    `);
    console.log('Active prices on 2026-09-07 after extension:', check);

  } catch (e) {
    console.error('Failed to extend prices:', e);
  } finally {
    process.exit(0);
  }
});
