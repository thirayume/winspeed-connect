'use strict';

// The authoritative setting lives in the deployment's primary DB, never in
// whichever database a session switched to. Rollout to workflows is partial.
const { DEFAULT_START_DATE, isValidStartDate, boundaries } = require('./data-window');
const KEY = 'GLOBAL_DATA_START_DATE';

function createReader({ readPrimary }) {
  if (typeof readPrimary !== 'function') throw new TypeError('readPrimary is required');
  return async function readGlobalDataWindow() {
    const raw = await readPrimary(KEY);
    const value = raw == null || raw === '' ? DEFAULT_START_DATE : String(raw).trim();
    if (!isValidStartDate(value)) throw Object.assign(new Error('INVALID_GLOBAL_DATA_START_DATE'), {code:'INVALID_GLOBAL_DATA_START_DATE'});
    return boundaries(value);
  };
}

async function readPrimarySetting(key) {
  const db = require('../db');
  const target = db.DEFAULT_TARGET;
  const primary = target === 'onprem' ? String(process.env.ONPREM_DB_NAME || '').trim() : null;
  if (target === 'onprem' && !primary) throw new Error('PRIMARY_DATABASE_REQUIRED');
  const pool = db.pools(target, primary);
  await pool.ready;
  const result = await pool.ownerPool.request().input('key', db.sql.NVarChar(100), key)
    .query('SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = @key');
  return result.recordset?.[0]?.SettingValue ?? null;
}

const readGlobalDataWindow = createReader({readPrimary:readPrimarySetting});

/** Version comparison happens while holding a SQL transaction lock on the primary DB. */
async function saveGlobalDataWindow({value, expectedValue, actorId}) {
  if (!isValidStartDate(value) || !isValidStartDate(expectedValue) || !Number.isSafeInteger(actorId) || actorId < 1) {
    throw Object.assign(new Error('INVALID_DATA_WINDOW'), {code:'INVALID_DATA_WINDOW',status:400});
  }
  const db = require('../db');
  const target = db.DEFAULT_TARGET;
  const primary = target === 'onprem' ? String(process.env.ONPREM_DB_NAME || '').trim() : null;
  if (target === 'onprem' && !primary) throw new Error('PRIMARY_DATABASE_REQUIRED');
  return db.runWithTarget(target, () => db.wfTransaction(async tx => {
    const existing = (await tx.request().input('key',db.sql.NVarChar(100),KEY)
      .query('SELECT SettingValue FROM wf.SystemSetting WITH (UPDLOCK,HOLDLOCK) WHERE SettingKey=@key')).recordset?.[0]?.SettingValue;
    const current = existing == null || existing === '' ? DEFAULT_START_DATE : String(existing).trim();
    if (!isValidStartDate(current)) throw Object.assign(new Error('INVALID_GLOBAL_DATA_START_DATE'),{code:'INVALID_GLOBAL_DATA_START_DATE',status:503});
    if (current !== expectedValue) throw Object.assign(new Error('STALE_DATA_WINDOW'),{code:'STALE_DATA_WINDOW',status:409});
    if (current === value) return {value,changed:false};
    await tx.request().input('key',db.sql.NVarChar(100),KEY).input('value',db.sql.NVarChar(200),value)
      .query(`MERGE wf.SystemSetting WITH (HOLDLOCK) AS t USING (SELECT @key AS SettingKey) AS s ON t.SettingKey=s.SettingKey
        WHEN MATCHED THEN UPDATE SET SettingValue=@value,UpdatedAt=GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT(SettingKey,SettingValue,Description) VALUES(@key,@value,N'Global data start date, Bangkok');`);
    await tx.request().input('actor',db.sql.Int,actorId).input('detail',db.sql.NVarChar(db.sql.MAX),JSON.stringify({before:current,after:value}))
      .query("INSERT wf.AdminChangeAudit(ActorId,Action,Target,Detail) VALUES(@actor,'GLOBAL_DATA_START_DATE','system',@detail)");
    return {value,changed:true};
  }),primary);
}

module.exports = { KEY, createReader, readGlobalDataWindow, saveGlobalDataWindow };
