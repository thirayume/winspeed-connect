/**
 * Runbook: Verify Users
 * Use this script to list current active users and their roles in the database.
 * Usage: node scripts/verify_users.js
 */
const { wfQuery, pools } = require('../db');

async function main() {
  console.log('--- User Verification ---');
  const users = await wfQuery(`SELECT Id, Username, DisplayName, Role, IsActive FROM wf.AppUser WHERE Username LIKE '%e2e%' OR Role IN ('SALES', 'MANAGER', 'ADMIN', 'WAREHOUSE', 'WEIGHBRIDGE')`);
  console.table(users.recordset);
  
  for (const p of Object.values(pools)) {
    try { (await p.readerPool).close(); } catch (_) {}
    try { (await p.ownerPool).close(); } catch (_) {}
  }
}

main().catch(console.error);
