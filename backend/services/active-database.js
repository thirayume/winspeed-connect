'use strict';

/**
 * Database selection (owner 2026-10-25).
 *
 *  - Primary database: ONPREM_DB_NAME, the environment's own database (UAT dbwins_worldfert9-uat,
 *    PROD dbwins_worldfert9). Migrations and the control settings below always use it.
 *  - System active database: an admin-settable default for everyone, stored under key
 *    ACTIVE_DATABASE in the PRIMARY database's wf.SystemSetting. Falls back to the primary.
 *  - Session database: a permitted role may switch their own session to any database in the
 *    switchable allowlist; it is carried in the JWT and resets to the system default on the next
 *    sign-in (logout or timeout).
 *
 * Every candidate must be in the environment's switchable allowlist (onprem-target.js), which is
 * the hard boundary; this service never widens it.
 */

const { sql, pools } = require('../db');
const { isSwitchableDb, switchableDatabases } = require('../onprem-target');

const SETTING_KEY = 'ACTIVE_DATABASE';
const CACHE_TTL_MS = 30 * 1000;
let cache = { value: null, at: 0 };

function primaryDatabase(env = process.env) {
  return String(env.ONPREM_DB_NAME || '').trim();
}

function onpremEnabled(env = process.env) {
  return String(env.DB_MODE || '').trim().toLowerCase() === 'onprem';
}

/** Owner pool of the PRIMARY database, where the control settings live regardless of the session. */
async function primaryOwnerPool() {
  const pl = pools('onprem', primaryDatabase());
  await pl.ready;
  return pl.ownerPool;
}

/** The admin-set system-wide default database, cached briefly; always a member of the allowlist. */
async function systemActiveDatabase(env = process.env) {
  const primary = primaryDatabase(env);
  if (!onpremEnabled(env)) return primary;
  if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  let value = primary;
  try {
    const pool = await primaryOwnerPool();
    const row = (await pool.request()
      .input('k', sql.NVarChar(50), SETTING_KEY)
      .query('SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = @k')).recordset?.[0];
    const stored = row?.SettingValue ? String(row.SettingValue).trim() : '';
    if (stored && isSwitchableDb(stored, env)) value = stored;
  } catch {
    // The control database is not reachable yet; fall back to the primary without caching.
    return primary;
  }
  cache = { value, at: Date.now() };
  return value;
}

/** Admin changes the system-wide default. The value must be in the allowlist. */
async function setSystemActiveDatabase(name, env = process.env) {
  const wanted = String(name || '').trim();
  if (!isSwitchableDb(wanted, env)) throw Object.assign(new Error('DB_NOT_ALLOWED'), { code: 'DB_NOT_ALLOWED', status: 400 });
  const pool = await primaryOwnerPool();
  await pool.request()
    .input('k', sql.NVarChar(50), SETTING_KEY)
    .input('v', sql.NVarChar(200), wanted)
    .input('d', sql.NVarChar(300), 'System-wide active Sale-App database (owner 2026-10-25)')
    .query(`MERGE wf.SystemSetting AS t USING (SELECT @k AS SettingKey) AS s ON t.SettingKey = s.SettingKey
            WHEN MATCHED THEN UPDATE SET SettingValue = @v, Description = @d, UpdatedAt = GETUTCDATE()
            WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, Description) VALUES (@k, @v, @d);`);
  cache = { value: wanted, at: Date.now() };
  return wanted;
}

/** The databases offered in the dropdown: allowlist members this login can actually open now. */
async function listSwitchableDatabases(env = process.env) {
  if (!onpremEnabled(env)) return [primaryDatabase(env)].filter(Boolean);
  const { wildcard } = switchableDatabases(env);
  let names = [];
  try {
    const pool = await primaryOwnerPool();
    const rows = (await pool.request().query(
      `SELECT name FROM sys.databases WHERE name LIKE 'dbwins_worldfert%' AND HAS_DBACCESS(name) = 1 ORDER BY name`
    )).recordset || [];
    names = rows.map(r => String(r.name).trim());
  } catch {
    names = [];
  }
  const allowed = names.filter(n => isSwitchableDb(n, env));
  if (!wildcard) {
    // Keep only the explicitly listed names, in the allowlist's order, that are reachable.
    const ordered = switchableDatabases(env).list.filter(n => allowed.some(a => a.toLowerCase() === n.toLowerCase()));
    return ordered.length ? ordered : [primaryDatabase(env)].filter(Boolean);
  }
  const primary = primaryDatabase(env);
  if (primary && !allowed.some(a => a.toLowerCase() === primary.toLowerCase())) allowed.unshift(primary);
  return allowed;
}

function clearCache() { cache = { value: null, at: 0 }; }

module.exports = {
  primaryDatabase, systemActiveDatabase, setSystemActiveDatabase, listSwitchableDatabases,
  isAllowedDatabase: isSwitchableDb, clearCache, onpremEnabled,
};
