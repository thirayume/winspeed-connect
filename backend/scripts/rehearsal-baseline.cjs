'use strict';
const crypto = require('crypto');
const runner = require('../run_migrations');
const { withSession, cli } = require('./rehearsal-session.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : Buffer.isBuffer(v) ? v.toString('hex') : v);
const digestRows = rows => hash(rows.map(r => hash(stable(r))).sort().join('\n'));
const quote = name => '[' + String(name).replace(/]/g, ']]') + ']';
async function tableDigest(pool, name) {
  const req = pool.request();
  // Serialize types on the server before the driver can round DECIMAL/BIGINT or dates.
  // Unsupported native XML types/characters must fail, never silently weaken the digest.
  const sql = 'SELECT (SELECT d.* FOR XML RAW, BINARY BASE64) AS RowXml FROM dbo.' + quote(name) + ' d';
  // Stream records, retaining only row hashes. Compare multisets (including duplicate counts).
  if (typeof req.on !== 'function') {
    const rows = (await req.query(sql)).recordset;
    if (!Array.isArray(rows)) throw new Error('Missing table data evidence');
    return { rows: String(rows.length), sha256: digestRows(rows) };
  }
  req.stream = true;
  const hashes = [];
  await new Promise((resolve, reject) => {
    req.on('row', row => hashes.push(hash(stable(row))));
    req.on('error', reject);
    req.on('done', resolve);
    Promise.resolve(req.query(sql)).catch(reject);
  });
  return { rows: String(hashes.length), sha256: hash(hashes.sort().join('\n')) };
}
const METADATA_SQL = `
SELECT t.name AS TableName, tr.name AS TriggerName, tr.is_disabled, tr.is_instead_of_trigger,
       m.definition
FROM sys.triggers tr JOIN sys.objects t ON tr.parent_id=t.object_id
JOIN sys.schemas s ON t.schema_id=s.schema_id LEFT JOIN sys.sql_modules m ON m.object_id=tr.object_id
WHERE s.name='dbo' ORDER BY t.name,tr.name;
`;
const INDEX_SQL = `
SELECT t.name AS TableName,i.name AS IndexName,i.type,i.is_unique,i.is_disabled,i.filter_definition,
       ic.key_ordinal,ic.is_descending_key,ic.is_included_column,c.name AS ColumnName
FROM sys.indexes i JOIN sys.tables t ON i.object_id=t.object_id
JOIN sys.schemas s ON t.schema_id=s.schema_id
LEFT JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id
LEFT JOIN sys.columns c ON ic.object_id=c.object_id AND ic.column_id=c.column_id
WHERE s.name='dbo' ORDER BY t.name,i.index_id,ic.index_column_id;
`;
async function snapshot(pool, target, backupSha256) {
  if (!/^[a-f0-9]{64}$/i.test(backupSha256 || '')) throw new Error('Verified source backup SHA256 required');
  const tables = (await pool.request().query("SELECT t.name FROM sys.tables t JOIN sys.schemas s ON t.schema_id=s.schema_id WHERE s.name='dbo' ORDER BY t.name")).recordset;
  if (!tables?.length) throw new Error('Missing dbo inventory evidence');
  const data = {};
  for (const t of tables) data[t.name] = await tableDigest(pool, t.name);
  const triggers = (await pool.request().query(METADATA_SQL)).recordset;
  if (!triggers?.length || triggers.some(t => t.definition == null)) throw new Error('Trigger definitions unavailable');
  const indexes = (await pool.request().query(INDEX_SQL)).recordset;
  if (!Array.isArray(indexes)) throw new Error('Index evidence missing');
  const applied = await runner.loadApplied(pool);
  return { schemaVersion: 1, capturedAt: new Date().toISOString(), backupSha256,
    target: { server: target.targetInfo.serverName, database: target.targetDatabase, profile: target.profile },
    data, triggers, indexes, ledger: [...applied.entries()].sort(([a],[b])=>a.localeCompare(b)) };
}
async function runBaseline(options = {}) {
  return withSession(options, 'local_rehearsal', async (pool, target) => {
    const result = await snapshot(pool, target, options.backupSha256);
    return { success: true, baseline: result };
  });
}
if (require.main === module) cli(runBaseline);
module.exports = { snapshot, runBaseline, digestRows, stable, METADATA_SQL, INDEX_SQL };

