/**
 * Runbook: Verify Prices and Users (Sample)
 * Use this script to spot check data from remote environments without committing credentials.
 * Usage: node scripts/verify_prices.js
 */
const { runWithTarget, query } = require('../db');

runWithTarget('remote_b', async () => {
  try {
    console.log('--- EMCust Sample ---');
    const custs = await query(`SELECT TOP 3 CustID, CustCode, CustName FROM dbo.EMCust WHERE CustID IS NOT NULL`);
    console.table(custs);
    
    console.log('--- AppUser Sample ---');
    const users = await query(`SELECT TOP 5 Id, Username, Role FROM wf.AppUser`);
    console.table(users);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
});
