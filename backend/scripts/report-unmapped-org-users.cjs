#!/usr/bin/env node
/**
 * report-unmapped-org-users.cjs — R12 item 12 (O-4 data prerequisite).
 *
 * Lists active users who have no wf.AppUser.PositionCode. Data scoping uses the org
 * chart (wf.OrgPosition.ReportsTo): an unmapped SALES user sees only their own records
 * and a team lead without subordinates mapped sees no team. Mapping users is owner/HR
 * work (screen "ผังองค์กร"); this script never writes.
 *
 * Usage (from the repo root): node backend/scripts/report-unmapped-org-users.cjs
 * SAFE: SELECT only.
 */
const path = require('path');
const db = require(path.join(__dirname, '..', 'db'));

(async () => {
  await db.pools().ready;
  const rows = (await db.wfQuery(`
    SELECT u.Id, u.Username, u.DisplayName, u.Role, u.EmpId,
           (SELECT COUNT(*) FROM wf.UserSaleArea a WHERE a.UserId = u.Id) AS SaleAreaRows
    FROM wf.AppUser u
    WHERE u.IsActive = 1 AND (u.PositionCode IS NULL OR LTRIM(RTRIM(u.PositionCode)) = '')
    ORDER BY u.Role, u.DisplayName`)).recordset || [];
  const total = (await db.wfQuery(`SELECT COUNT(*) AS n FROM wf.AppUser WHERE IsActive = 1`)).recordset[0].n;
  console.log(`Active users: ${total} · without an org-chart position: ${rows.length}`);
  const byRole = rows.reduce((m, r) => ((m[r.Role] = (m[r.Role] || 0) + 1), m), {});
  console.log('By role:', JSON.stringify(byRole));
  for (const r of rows) {
    const effect = ['ADMIN', 'C_LEVEL', 'ACCOUNTING', 'WAREHOUSE', 'WEIGHBRIDGE', 'COUNTER_SALES', 'APPROVER'].includes(r.Role)
      ? 'sees all (role)' : r.Role === 'MANAGER' ? (r.SaleAreaRows ? 'falls back to its regions' : 'own records only (no region)') : 'own records only';
    console.log(`  #${r.Id} ${r.Username} · ${r.DisplayName} · ${r.Role} · EmpId ${r.EmpId || '-'} → ${effect}`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
