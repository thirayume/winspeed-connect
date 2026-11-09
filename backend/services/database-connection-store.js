'use strict';
// Host-local encrypted configuration. Never store credentials in a restored business database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bootSnapshots = new Map();
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
function configured(env) {
  const hasFile=Boolean(env.ONPREM_CONNECTION_STORE_FILE), hasKey=Boolean(env.ONPREM_CONNECTION_KEY_FILE);
  if (hasFile !== hasKey) throw fail('CONNECTION_STORE_INVALID',503);
  return hasFile && hasKey;
}
function paths(env) {
  if (!configured(env)) throw fail('CONNECTION_STORE_NOT_CONFIGURED', 503);
  const file = path.resolve(env.ONPREM_CONNECTION_STORE_FILE), key = path.resolve(env.ONPREM_CONNECTION_KEY_FILE);
  if (file === key) throw fail('CONNECTION_STORE_INVALID', 503);
  return { file, key };
}
function readKey(env) {
  const key = fs.readFileSync(paths(env).key);
  if (key.length !== 32) throw fail('CONNECTION_KEY_INVALID', 503);
  return key;
}
function read(env) {
  const { file } = paths(env);
  try {
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (envelope.version !== 1) throw Error('version');
    const cipher = crypto.createDecipheriv('aes-256-gcm', readKey(env), Buffer.from(envelope.iv, 'base64'));
    cipher.setAAD(Buffer.from('SaleApp.database-connections.v1'));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const state = JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]).toString('utf8'));
    if (state.version !== 1 || !state.profiles || !Array.isArray(state.audit)) throw Error('shape');
    return state;
  } catch { throw fail('CONNECTION_STORE_UNREADABLE', 503); }
}
function write(env, state) {
  const { file } = paths(env), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', readKey(env), iv);
  cipher.setAAD(Buffer.from('SaleApp.database-connections.v1'));
  const data = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
async function mutate(env, fn) {
  const lock = paths(env).file + '.lock';
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch { throw fail('CONNECTION_STORE_BUSY', 409); }
  try { const state = read(env); const result = await fn(state); write(env, state); return result; }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function initialize(env) {
  const { file, key } = paths(env);
  if (fs.existsSync(file) || fs.existsSync(key)) throw fail('CONNECTION_STORE_ALREADY_EXISTS', 409);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(key), { recursive: true, mode: 0o700 });
  fs.writeFileSync(key, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  write(env, { version: 1, profiles: {}, audit: [] });
}
function audit(state, action, name, revision, actor) {
  // Whitelist audit fields: no submitted payload, username, password, driver errors or connection strings.
  state.audit.push({ at: new Date().toISOString(), action, name, revision, actor: String(actor) });
}
function activeProfiles(env = process.env) {
  if (env.ONPREM_CONNECTION_PROFILES_DISABLE === 'true' || !configured(env)) return {};
  const id = paths(env).file;
  if (!bootSnapshots.has(id)) {
    const profiles = read(env).profiles;
    bootSnapshots.set(id, Object.fromEntries(Object.entries(profiles).filter(([,v]) => v.active).map(([k,v]) => [k, v.active])));
  }
  return bootSnapshots.get(id);
}
module.exports = { configured, paths, read, mutate, initialize, audit, activeProfiles, fail };
