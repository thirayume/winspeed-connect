'use strict';

/**
 * onprem-preflight.cjs — read-only check of the office SQL Server target before installing or migrating.
 *
 *   docker compose -f docker-compose.office.yml exec backend node scripts/onprem-preflight.cjs
 *
 * Connects with the app login (DB_MODE=onprem, settings from .env), which runs the same identity guard as the API
 * (approved server, database, login and engine, no elevated role, TCP), then reports the database, the WINSpeed
 * tables, the wf schema and the app login's permissions. Nothing is written. Exit 1 when something blocks go-live.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), quiet: true });
process.env.DB_MODE = 'onprem';

const blockers = [];
const ok = m => console.log(`  ✓ ${m}`);
const bad = m => { blockers.push(m); console.log(`  ✗ ${m}`); };
const info = m => console.log(`  · ${m}`);

// app login permissions the API needs, and one it must not have (dbo writes go through wf procedures)
const PERMS = [
  ['read dbo.SOHD', "HAS_PERMS_BY_NAME('dbo.SOHD', 'OBJECT', 'SELECT')", 1],
  ['execute schema wf', "HAS_PERMS_BY_NAME('wf', 'SCHEMA', 'EXECUTE')", 1],
  ['write schema wf', "HAS_PERMS_BY_NAME('wf', 'SCHEMA', 'INSERT')", 1],
  ['insert dbo.SODT', "HAS_PERMS_BY_NAME('dbo.SODT', 'OBJECT', 'INSERT')", 1],
  ['update dbo.SOHD.DocuStatus', "HAS_PERMS_BY_NAME('dbo.SOHD', 'OBJECT', 'UPDATE', 'DocuStatus', 'COLUMN')", 1],
  ['no direct insert into dbo.SOHD', "HAS_PERMS_BY_NAME('dbo.SOHD', 'OBJECT', 'INSERT')", 0],
  ['no update of dbo.SOHD.AppvFlag', "HAS_PERMS_BY_NAME('dbo.SOHD', 'OBJECT', 'UPDATE', 'AppvFlag', 'COLUMN')", 0],
];

(async () => {
  console.log('\n=== Sale-App · office SQL Server preflight (read-only) ===');
  const db = require('../db');
  let pools;
  try {
    pools = db.pools('onprem');
    await pools.ready;
  } catch (e) {
    bad(`connection or identity guard failed: ${e.message}`);
    console.log('\n  check ONPREM_* in .env, the VPN/route (nc -vz <server> <port>), and ONPREM_DB_LEGACY_TLS for SQL 2008 R2');
    process.exit(1);
  }
  const q = async text => (await pools.readerPool.request().query(text)).recordset || [];

  const [id] = await q(`SELECT DB_NAME() AS db, @@SERVERNAME AS server, SUSER_SNAME() AS login,
      CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(40)) AS version, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(80)) AS edition,
      CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS NVARCHAR(80)) AS collation,
      (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compat,
      CONVERT(VARCHAR(19), GETDATE(), 120) AS serverTime`);
  ok(`identity guard passed: ${id.login} @ ${id.server} / ${id.db}`);
  info(`engine ${id.version} (${id.edition}) · compatibility ${id.compat} · collation ${id.collation}`);
  if (id.collation !== 'Thai_CI_AS') bad(`collation is ${id.collation}, the WINSpeed database is Thai_CI_AS`);
  const appTime = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const skew = Math.abs(new Date(id.serverTime.replace(' ', 'T') + 'Z') - new Date(appTime.replace(' ', 'T') + 'Z')) / 1000;
  if (skew > 120) bad(`clock: SQL Server ${id.serverTime}, API (Bangkok) ${appTime}: ${Math.round(skew)} s apart`);
  else ok(`clock within ${Math.round(skew)} s of SQL Server (${id.serverTime})`);

  const [t] = await q(`SELECT
      CASE WHEN OBJECT_ID('dbo.SOHD', 'U') IS NULL THEN -1 ELSE (SELECT COUNT(*) FROM dbo.SOHD WITH (NOLOCK)) END AS sohd,
      CASE WHEN OBJECT_ID('dbo.EMCust', 'U') IS NULL THEN -1 ELSE (SELECT COUNT(*) FROM dbo.EMCust WITH (NOLOCK)) END AS cust,
      CASE WHEN OBJECT_ID('dbo.EMRunBrch', 'U') IS NULL THEN -1 ELSE (SELECT COUNT(*) FROM dbo.EMRunBrch WITH (NOLOCK)) END AS runs,
      CONVERT(VARCHAR(10), (SELECT MAX(DocuDate) FROM dbo.SOHD WITH (NOLOCK)), 120) AS lastDoc`);
  if (t.sohd < 0 || t.cust < 0 || t.runs < 0) bad('WINSpeed tables missing (dbo.SOHD / EMCust / EMRunBrch): is this the WINSpeed database?');
  else ok(`WINSpeed data: ${t.sohd.toLocaleString()} SOHD documents, last ${t.lastDoc} · ${t.cust.toLocaleString()} customers`);

  const [w] = await q(`SELECT SCHEMA_ID('wf') AS wfId, USER_NAME((SELECT principal_id FROM sys.schemas WHERE name = 'wf')) AS owner,
      CASE WHEN OBJECT_ID('wf.SchemaMigration', 'U') IS NULL THEN -1 ELSE (SELECT COUNT(*) FROM wf.SchemaMigration) END AS applied`);
  if (!w.wfId) bad('schema wf missing: run deploy/onprem/sql/office-logins.sql first');
  else if (w.owner !== 'dbo') bad(`schema wf is owned by ${w.owner}; it must be dbo (wf procedures write WINSpeed tables by ownership chaining)`);
  else ok(`schema wf owned by dbo · ${w.applied < 0 ? 'no migrations yet (new install)' : `${w.applied} migrations recorded`}`);

  for (const [label, expr, want] of PERMS) {
    const [r] = await q(`SELECT ${expr} AS v`);
    if (Number(r.v) === want) ok(`app login: ${label}`);
    else bad(`app login: ${label} (got ${r.v}, expected ${want}) — re-run office-logins.sql or check extra grants`);
  }

  console.log(blockers.length ? `\n  ${blockers.length} blocker(s)\n` : '\n  ready: next, the migration plan (--profile migrate run --rm migrate --plan)\n');
  process.exit(blockers.length ? 1 : 0);
})().catch(e => { console.error(`  ✗ ${e.message}`); process.exit(1); });
