const { runWithTarget, wfQuery } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    // Check if there are active rebate plans
    const plans = await wfQuery(`
      SELECT PlanId, PlanNo, GoodCodePattern, Region, NetPrice, Status, ValidFrom, ValidTo
      FROM wf.RebatePlan
      WHERE Status IN ('ACTIVE', 'APPROVED')
    `);
    console.log('Active Rebate Plans in DB:', plans.recordset);

    // Check eligible lots in v_RebateAccrualRemaining
    const lots = await wfQuery(`
      SELECT TOP 5 CustId, CustCode, CustName, GoodCode, QtyTon, RemainingTonRebate, NetPricePerTon, PlanId, SourceSOID, SourceListNo
      FROM wf.v_RebateAccrualRemaining
      WHERE RemainingTonRebate > 0
      ORDER BY SourceDocuDate DESC
    `);
    console.log('Eligible Lots:', lots.recordset);
  });
}

main().catch(console.error);
