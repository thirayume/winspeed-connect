'use strict';
// Read-only UAT lock sampling. Run only during a coordinated WinSpeed rehearsal;
// it does not drive WinSpeed, record SQL text or change database settings.
const allowedDatabase = 'dbwins_worldfert9_uat';
const allowedServer = 'R740-SRV\\SQL2008';
const SAMPLE_SQL = `SELECT COUNT(*) AS Requests,
  SUM(CASE WHEN blocking_session_id <> 0 THEN 1 ELSE 0 END) AS Blocked,
  SUM(CASE WHEN wait_type LIKE 'LCK[_]M[_]%' THEN 1 ELSE 0 END) AS LockWaits,
  MAX(CASE WHEN blocking_session_id <> 0 THEN wait_time ELSE 0 END) AS MaxBlockedWaitMs
  FROM sys.dm_exec_requests
  WHERE database_id = DB_ID() AND session_id <> @@SPID`;

async function sampleLocks({ query, delay, seconds, intervalMs = 5000 }) {
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 300)
    throw new Error('seconds must be an integer between 10 and 300');
  const identity = (await query(`SELECT DB_NAME() AS DbName, CONVERT(varchar(128), @@SERVERNAME) AS ServerName,
    HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE') AS CanView`)).recordset?.[0];
  if (String(identity?.DbName || '').toLowerCase() !== allowedDatabase ||
      String(identity?.ServerName || '').toUpperCase() !== allowedServer)
    throw new Error('refused: expected UAT on R740-SRV\\SQL2008');
  if (Number(identity.CanView) !== 1) throw new Error('VIEW SERVER STATE permission required to inspect lock waits');
  const samples = Math.ceil(seconds * 1000 / intervalMs);
  let blockedSamples = 0, maxBlocked = 0, maxLockWaits = 0, maxWaitMs = 0;
  for (let i = 0; i < samples; i++) {
    const row = (await query(SAMPLE_SQL)).recordset?.[0] || {};
    const blocked = Number(row.Blocked || 0), waits = Number(row.LockWaits || 0);
    if (blocked > 0) blockedSamples++;
    maxBlocked = Math.max(maxBlocked, blocked);
    maxLockWaits = Math.max(maxLockWaits, waits);
    maxWaitMs = Math.max(maxWaitMs, Number(row.MaxBlockedWaitMs || 0));
    if (i + 1 < samples) await delay(intervalMs);
  }
  return { samples, sampleIntervalMs: intervalMs, blockedSamples, maxBlocked, maxLockWaits, maxWaitMs };
}

async function main() {
  if (!process.argv.includes('--observe-uat') || String(process.env.ONPREM_DB_NAME || '').toLowerCase() !== allowedDatabase)
    throw new Error('refused: provide --observe-uat and configure the UAT database');
  const i = process.argv.indexOf('--seconds');
  const seconds = i < 0 ? 60 : Number(process.argv[i + 1]);
  const db = require('../db');
  try {
    const result = await db.runWithTarget('onprem', () => sampleLocks({
      query: db.wfQuery, seconds, delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
    }), allowedDatabase);
    console.log(JSON.stringify({ observedAt: new Date().toISOString(), database: allowedDatabase, ...result,
      note: 'Samples cover UAT requests only; coordinate and record WinSpeed activity separately.' }));
  } finally { await db.closeAll(); }
}
if (require.main === module) main().catch(error => { console.error('UAT_LOCK_OBSERVATION_FAILED: ' + error.message); process.exitCode = 1; });
module.exports = { sampleLocks, SAMPLE_SQL };
