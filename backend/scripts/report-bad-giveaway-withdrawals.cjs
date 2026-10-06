/**
 * report-bad-giveaway-withdrawals.cjs
 *
 * READ-ONLY audit report listing existing bad rows in:
 * 1. wf.GiveawayWithdrawal (numeric Brand, Brand used as ItemName, or sack-ton inflated quantities)
 * 2. wf.GiveawayItemMapping (inverted rows where numeric GoodID is in Brand and Brand is in ItemName)
 *
 * SAFE: Performs SELECT queries only. No data is modified.
 */
const { query } = require('../db');

async function runReport() {
  console.log('================================================================');
  console.log('     READ-ONLY AUDIT: BAD GIVEAWAY WITHDRAWALS & MAPPINGS');
  console.log('================================================================\n');

  try {
    // 1. Audit wf.GiveawayWithdrawal
    const badWithdrawals = await query(`
      SELECT Id, SalesUserId, EmpCode, Region, PeriodYear, IssueMonth,
             Brand, ItemName, Qty, CustId, SoId, Note, CreatedAt
      FROM wf.GiveawayWithdrawal
      WHERE ISNUMERIC(Brand) = 1
         OR ItemName IN (N'รถเกษตร', N'ปุ๋ยเทพ')
         OR Qty >= 1000
      ORDER BY Id
    `);

    console.log(`[1] wf.GiveawayWithdrawal — Found ${badWithdrawals.length} suspicious rows:`);
    if (badWithdrawals.length === 0) {
      console.log('    ✓ No suspicious withdrawal rows found.');
    } else {
      console.table(badWithdrawals.map(r => ({
        Id: r.Id,
        Region: r.Region,
        Brand: r.Brand,
        ItemName: r.ItemName,
        Qty: r.Qty,
        SoId: r.SoId,
        IssueReason: [
          /^\d+$/.test(String(r.Brand).trim()) ? 'NUMERIC_BRAND' : null,
          ['รถเกษตร', 'ปุ๋ยเทพ'].includes(String(r.ItemName).trim()) ? 'BRAND_AS_ITEMNAME' : null,
          Number(r.Qty) >= 1000 ? 'UNUSUALLY_LARGE_QTY' : null,
        ].filter(Boolean).join(' | '),
        CreatedAt: r.CreatedAt ? new Date(r.CreatedAt).toISOString().slice(0, 19) : ''
      })));
    }

    console.log('\n----------------------------------------------------------------\n');

    // 2. Audit wf.GiveawayItemMapping
    const badMappings = await query(`
      SELECT m.Id, m.GoodID, g.GoodCode, g.GoodName1, m.Brand, m.ItemName, m.CreatedAt
      FROM wf.GiveawayItemMapping m
      LEFT JOIN dbo.EMGood g ON g.GoodID = m.GoodID
      WHERE ISNUMERIC(m.Brand) = 1
         OR m.ItemName IN (N'รถเกษตร', N'ปุ๋ยเทพ')
      ORDER BY m.Id
    `);

    console.log(`[2] wf.GiveawayItemMapping — Found ${badMappings.length} inverted mapping rows:`);
    if (badMappings.length === 0) {
      console.log('    ✓ No inverted mapping rows found.');
    } else {
      console.table(badMappings.map(r => ({
        Id: r.Id,
        GoodID: r.GoodID,
        GoodCode: r.GoodCode,
        GoodName: r.GoodName1,
        StoredBrand: r.Brand,
        StoredItemName: r.ItemName,
        IssueReason: [
          /^\d+$/.test(String(r.Brand).trim()) ? 'NUMERIC_BRAND' : null,
          ['รถเกษตร', 'ปุ๋ยเทพ'].includes(String(r.ItemName).trim()) ? 'BRAND_AS_ITEMNAME' : null,
        ].filter(Boolean).join(' | '),
        CreatedAt: r.CreatedAt ? new Date(r.CreatedAt).toISOString().slice(0, 19) : ''
      })));
    }

    console.log('\n================================================================');
    console.log('Summary:');
    console.log(`- Suspicious GiveawayWithdrawal rows : ${badWithdrawals.length}`);
    console.log(`- Inverted GiveawayItemMapping rows  : ${badMappings.length}`);
    console.log('Recommendation for Owner: Review rows above for cleanup.');
    console.log('================================================================');
  } catch (err) {
    console.error('Audit report failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runReport().then(() => process.exit(0));
}

module.exports = { runReport };
