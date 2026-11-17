'use strict';

// Exact, reviewed simulation targets. Neither live company database can be
// opted in. The disposable fz8 clone also needs an isolated runtime opt-in.
const TARGETS = Object.freeze([
  Object.freeze({ server: 'AMYOU-YOGA7\\V2008R2', database: 'dbwins_worldfert9_uat2', id: 10 }),
  Object.freeze({ server: 'R740-SRV\\SQL2008', database: 'dbwins_worldfert9_uat', id: 10 }),
]);
const FZ8_DATABASE = 'dbwins_worldfert9_uat_fz8';
const FZ8 = Object.freeze({server:'R740-SRV\\SQL2008',database:FZ8_DATABASE,id:15});

function fz8RuntimeEnabled(env = process.env) {
  return env.NATIVE_FZ8_FULL_LOOP === 'true' && env.ONPREM_DB_NAME === FZ8_DATABASE
    && env.ONPREM_SWITCHABLE_DATABASES === FZ8_DATABASE && env.ONPREM_TARGET_KIND === 'uat'
    && env.ONPREM_CONNECTION_PROFILES_DISABLE === 'true' && env.DISABLE_BACKGROUND_WORKERS === 'true'
    && !Object.keys(env).some(key => key.startsWith('REBATE_') && String(env[key]).toLowerCase() === 'true');
}

function isInitialNativeUatTarget(record, env = process.env) {
  if (!record) return false;
  const matches = target => record.ServerName === target.server && record.DbName === target.database
    && Number(record.DbId) === target.id;
  return TARGETS.some(matches) || (matches(FZ8) && fz8RuntimeEnabled(env));
}

module.exports = { isInitialNativeUatTarget, fz8RuntimeEnabled, FZ8_DATABASE };
