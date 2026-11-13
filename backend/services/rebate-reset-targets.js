'use strict';

// Reset targets must come from reviewed deployment configuration, never from
// a browser payload or the session database selector. Wildcard discovery is
// unsafe for an operation that changes every customer balance.
function fail(code) { throw Object.assign(new Error(code), { code, status: 503 }); }
function resolveResetTargets({ environment, primaryDatabase, configuredTargets, switchableTargets, wildcard = false } = {}) {
  if (!['uat', 'production'].includes(environment)) fail('REBATE_RESET_ENVIRONMENT_INVALID');
  if (wildcard || !Array.isArray(switchableTargets)) fail('REBATE_RESET_TARGETS_NOT_PINNED');
  if (!Array.isArray(configuredTargets) || !configuredTargets.length) fail('REBATE_RESET_TARGETS_NOT_CONFIGURED');
  const namePattern = /^dbwins_worldfert[0-9A-Za-z._-]*$/i;
  const primary = String(primaryDatabase || '').trim();
  if (!namePattern.test(primary)) fail('REBATE_RESET_PRIMARY_INVALID');
  const allowed = new Set(switchableTargets.map(v => String(v).trim().toLowerCase()));
  const seen = new Set();
  const targets = configuredTargets.map(value => {
    const name = String(value || '').trim();
    const key = name.toLowerCase();
    if (!namePattern.test(name) || !allowed.has(key)) fail('REBATE_RESET_TARGET_NOT_ALLOWED');
    if (seen.has(key)) fail('REBATE_RESET_TARGET_DUPLICATE');
    // The currently approved R740 UAT databases use an explicit UAT suffix.
    // This is a backstop, not a substitute for reviewed environment manifests.
    if (environment === 'production' && /(?:^|[-_.])uat(?:$|[-_.0-9])/.test(key)) fail('REBATE_RESET_CROSS_ENVIRONMENT');
    seen.add(key);
    return name;
  });
  if (!seen.has(primary.toLowerCase())) fail('REBATE_RESET_PRIMARY_MISSING');
  return targets;
}

function configuredResetTargets(env = process.env) {
  if (String(env.DB_MODE || '').trim().toLowerCase() !== 'onprem') fail('REBATE_RESET_ENVIRONMENT_INVALID');
  const environment = String(env.ONPREM_TARGET_KIND || '').trim().toLowerCase();
  const raw = String(env.REBATE_RESET_DATABASES || '').trim();
  if (!raw || raw === '*') fail('REBATE_RESET_TARGETS_NOT_CONFIGURED');
  const parts = raw.split(',').map(s => s.trim());
  if (parts.some(s => !s)) fail('REBATE_RESET_TARGETS_NOT_CONFIGURED');
  const { list, wildcard } = require('../onprem-target').switchableDatabases(env);
  return resolveResetTargets({ environment, primaryDatabase: env.ONPREM_DB_NAME,
    configuredTargets: parts, switchableTargets: list, wildcard });
}

function resolvePhysicalResetTargets(env = process.env, tupleResolver = require('../onprem-target').onpremTuple) {
  const names = configuredResetTargets(env);
  const seen = new Set();
  return names.map(name => {
    // Do not return the tuple itself: it contains SQL credentials.
    const tuple = tupleResolver(env, 'runtime', name);
    const database = String(tuple?.database || '').trim();
    const server = String(tuple?.expectedServerName || '').trim();
    if (!database || !server) fail('REBATE_RESET_TARGET_IDENTITY_INVALID');
    if (String(env.ONPREM_TARGET_KIND).toLowerCase() === 'production' &&
        /(?:^|[-_.])uat(?:$|[-_.0-9])/i.test(database)) fail('REBATE_RESET_CROSS_ENVIRONMENT');
    const physicalKey = `${server.toLowerCase()}\0${database.toLowerCase()}`;
    if (seen.has(physicalKey)) fail('REBATE_RESET_PHYSICAL_TARGET_DUPLICATE');
    // A connection profile can route a session alias to a different database.
    // A destructive reset needs an explicitly reviewed physical target mapping;
    // until that mapping exists, require the pinned logical and physical names
    // to match, including for UAT (which must never redirect to production).
    if (database.toLowerCase() !== name.toLowerCase()) fail('REBATE_RESET_PHYSICAL_NAME_MISMATCH');
    seen.add(physicalKey);
    return { name, database, expectedServerName: server };
  });
}

module.exports = { resolveResetTargets, configuredResetTargets, resolvePhysicalResetTargets };
