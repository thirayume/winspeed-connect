'use strict';
const store = require('./database-connection-store');
const { fail } = store;
const fields = ['server','port','database','username','expectedServerName','versionPrefix','encrypt','legacyTls','tdsVersion'];
const lc = value => String(value || '').trim().toLowerCase();
function defaults(name, env) {
  return { server: env.ONPREM_DB_SERVER || '', port: Number(env.ONPREM_DB_PORT || 1433), database: name,
    username: env.ONPREM_DB_USER || '', expectedServerName: env.ONPREM_EXPECTED_SERVERNAME || '',
    versionPrefix: env.ONPREM_PRODUCT_VERSION_PREFIX || '', encrypt: env.ONPREM_DB_ENCRYPT !== 'false',
    legacyTls: env.ONPREM_DB_LEGACY_TLS === 'true', tdsVersion: env.ONPREM_DB_TDS_VERSION || '7_3_B' };
}
function allowedName(name, env) {
  if (typeof name !== 'string' || name !== name.trim() || !require('../onprem-target').isSwitchableDb(name, env)) throw fail('CONNECTION_DATABASE_NOT_ALLOWED');
}
function canonicalName(name, env, state) {
  if (typeof name !== 'string' || name !== name.trim()) throw fail('CONNECTION_DATABASE_NOT_ALLOWED');
  allowedName(name.toLowerCase(), env);
  return [...require('../onprem-target').switchableDatabases(env).list, ...Object.keys(state.profiles)].find(n => lc(n) === lc(name)) || name.toLowerCase();
}
function normalize(name, input, old, env) {
  allowedName(name, env);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('CONNECTION_INVALID');
  const value = Object.fromEntries(fields.map(k => [k, input[k]]));
  for (const key of ['server','database','username','expectedServerName','versionPrefix','tdsVersion']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 128 || /[;{}\x00-\x1f]/.test(value[key])) throw fail('CONNECTION_INVALID');
    value[key] = value[key].trim();
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value.server) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || /^sa$/i.test(value.username)) throw fail('CONNECTION_INVALID');
  if (typeof value.encrypt !== 'boolean' || typeof value.legacyTls !== 'boolean' || !['7_3_B','7_4'].includes(value.tdsVersion)) throw fail('CONNECTION_INVALID');
  // Exact password bytes survive (including whitespace, quotes, Thai, $, &, and }). Empty means keep.
  if (input.password !== undefined && typeof input.password !== 'string') throw fail('CONNECTION_INVALID');
  value.password = input.password || old?.password || '';
  if (!value.password || value.password.length > 1024 || /[\x00\r\n]/.test(value.password)) throw fail('CONNECTION_PASSWORD_REQUIRED');
  return value;
}
function approved(name, value, env, { activation = false } = {}) {
  allowedName(name, env);
  allowedName(value.database, env);
  let tuples;
  try { tuples = JSON.parse(env.ONPREM_PROFILE_ALLOWED_TARGETS || '[]'); } catch { throw fail('CONNECTION_TARGET_POLICY_INVALID',503); }
  if (!Array.isArray(tuples) || tuples.some(t => !t || typeof t !== 'object' || Array.isArray(t))) throw fail('CONNECTION_TARGET_POLICY_INVALID',503);
  const base = { ...defaults(name,env), name };
  const matches = [base,...tuples].some(t => lc(t.name) === lc(name) && ['server','database','expectedServerName','versionPrefix','tdsVersion'].every(k => lc(t[k]) === lc(value[k])) && Number(t.port) === value.port && t.encrypt === value.encrypt && t.legacyTls === value.legacyTls);
  if (!matches) throw fail('CONNECTION_TARGET_NOT_APPROVED',403);
  // The primary/auth/migration bootstrap must keep one target. IT updates deployment pins first.
  if (activation && lc(name) === lc(env.ONPREM_DB_NAME) && !['server','database','expectedServerName','versionPrefix','tdsVersion','port','encrypt','legacyTls'].every(k => lc(base[k]) === lc(value[k]))) throw fail('CONNECTION_PRIMARY_REQUIRES_DEPLOY_CONFIG',409);
}
function connectionEnv(value, env) {
  return { ...env, ONPREM_CONNECTION_PROFILES_DISABLE:'true', ONPREM_DB_SERVER:value.server,
    ONPREM_DB_PORT:String(value.port), ONPREM_DB_INSTANCE:'', ONPREM_DB_USER:value.username,
    ONPREM_DB_PASSWORD:value.password, ONPREM_EXPECTED_SERVERNAME:value.expectedServerName,
    ONPREM_PRODUCT_VERSION_PREFIX:value.versionPrefix, ONPREM_DB_ENCRYPT:String(value.encrypt),
    ONPREM_DB_LEGACY_TLS:String(value.legacyTls), ONPREM_DB_TDS_VERSION:value.tdsVersion };
}
async function probe(name, value, env) {
  approved(name,value,env);
  const { validateOnpremTargetRecord, IDENTITY_SQL } = require('../onprem-target');
  const settings = connectionEnv(value,env);
  const pool = require('../db').createOnpremProbePool(settings,value.database);
  pool.on('error',()=>{});
  try {
    await pool.connect();
    const row = (await pool.request().query(IDENTITY_SQL)).recordset?.[0];
    validateOnpremTargetRecord(row,settings,{operation:'runtime',overrideDb:value.database});
    const schema = (await pool.request().query("SELECT CASE WHEN OBJECT_ID('wf.AppUser','U') IS NOT NULL AND OBJECT_ID('wf.SystemSetting','U') IS NOT NULL THEN 1 ELSE 0 END AS ready")).recordset?.[0];
    if (schema?.ready !== 1) throw fail('CONNECTION_SCHEMA_NOT_READY');
  } catch { throw fail('CONNECTION_TEST_FAILED',422); }
  finally { await pool.close().catch(()=>{}); }
}
function sanitized(value) { return value ? { ...Object.fromEntries(fields.map(k=>[k,value[k]])), passwordSet:Boolean(value.password) } : null; }
function createService(env=process.env, testProbe=probe) {
  function list() {
    const names = require('../onprem-target').switchableDatabases(env).list;
    if (!store.configured(env)) return { configured:false, profiles:names.map(name=>({name,revision:0,draft:defaults(name,env),active:null,testedAt:null,activeRevision:null})),audit:[] };
    const state=store.read(env);
    const all=[...new Set([...names,...Object.keys(state.profiles)])].filter(n=>require('../onprem-target').isSwitchableDb(n,env));
    return { configured:true, profiles:all.map(name=>{const p=state.profiles[name];return {name,revision:p?.revision||0,draft:sanitized(p?.draft)||{...defaults(name,env),passwordSet:false},active:sanitized(p?.active?.value),activeRevision:p?.active?.revision||null,testedAt:p?.tested?.at||null};}),audit:state.audit.slice(-30).reverse() };
  }
  async function save(name,input,revision,actor) {
    return store.mutate(env,state=>{
      name = canonicalName(name,env,state);
      const p=state.profiles[name]||{revision:0};
      if (!Number.isInteger(revision)||revision!==p.revision) throw fail('CONNECTION_STALE',409);
      const draft=normalize(name,input,p.draft,env);
      state.profiles[name]={...p,draft,revision:revision+1,tested:null};
      store.audit(state,'DRAFT_SAVED',name,revision+1,actor);
      return {revision:revision+1};
    });
  }
  async function test(name,revision,actor) {
    const state=store.read(env);
    name=canonicalName(name,env,state);
    const p=state.profiles[name];
    if (!p||p.revision!==revision) throw fail('CONNECTION_STALE',409);
    approved(name,p.draft,env);
    await testProbe(name,p.draft,env);
    return store.mutate(env,state=>{
      const current=state.profiles[name];
      if (!current||current.revision!==revision) throw fail('CONNECTION_STALE',409);
      current.tested={revision,at:new Date().toISOString()};
      store.audit(state,'TEST_PASSED',name,revision,actor);
      return {revision,testedAt:current.tested.at};
    });
  }
  async function activate(name,revision,actor) {
    // CLI only. Take a cross-process lock during the fresh check and activation. No web apply route.
    return store.mutate(env,async state=>{
      name=canonicalName(name,env,state);
      const p=state.profiles[name];
      if (!p||p.revision!==revision) throw fail('CONNECTION_STALE',409);
      approved(name,p.draft,env,{activation:true});
      if (p.active?.revision===revision) return {revision,restartRequired:true,alreadyActivated:true};
      const testedAt=Date.parse(p.tested?.at);
      if (p.tested?.revision!==revision || !Number.isFinite(testedAt) || testedAt>Date.now() || Date.now()-testedAt>30*60*1000) throw fail('CONNECTION_TEST_REQUIRED',409);
      await testProbe(name,p.draft,env);
      p.previous=p.active||null;
      p.active={revision,value:{...p.draft},at:new Date().toISOString()};
      store.audit(state,'ACTIVATED_RESTART_REQUIRED',name,revision,actor);
      return {revision,restartRequired:true};
    });
  }
  async function rollback(name,actor) {
    return store.mutate(env,async state=>{
      name=canonicalName(name,env,state); const p=state.profiles[name];
      if(!p?.active) throw fail('CONNECTION_NO_ACTIVE_PROFILE',409);
      const previous=p.previous?.value || {...defaults(name,env),password:env.ONPREM_DB_PASSWORD};
      approved(name,previous,env,{activation:true});
      await testProbe(name,previous,env);
      p.active=p.previous||null; p.previous=null;
      store.audit(state,'ROLLED_BACK_RESTART_REQUIRED',name,p.active?.revision||0,actor);
      return {restartRequired:true};
    });
  }
  return {list,save,test,activate,rollback};
}
module.exports={createService,defaults,approved,connectionEnv,probe,sanitized};
