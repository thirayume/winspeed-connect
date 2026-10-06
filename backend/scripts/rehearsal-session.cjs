'use strict';

// Live execution is prepared, NOT RUN. This module does not import db.js.
const runner = require('../run_migrations');
const { APPROVED_LOCAL_REHEARSAL_TARGET, APPROVED_TARGET } = require('../safety-validator');

function authorize(options, profile) {
  if (options.profile && options.profile !== profile) throw new Error('Requested profile does not match this rehearsal step');
  if (!['local_rehearsal', 'remote_b'].includes(profile)) throw new Error('Unsupported rehearsal profile');
  if (!['mock', 'live'].includes(options.mode)) throw new Error('Explicit mode=mock|live required');
  if (options.pool || options.fakePool) throw new Error('Pool injection is prohibited; use mock responses or a driver factory');
  if (options.mode === 'mock' && options.driverFactory) throw new Error('Mock mode cannot accept a driver factory');
  if (options.mode === 'live') {
    if (process.env.ALLOW_LIVE_REHEARSAL !== 'true' || process.env.REHEARSAL_APPROVED_PROFILE !== profile) {
      throw new Error('BLOCKED: live rehearsal requires approval and exact REHEARSAL_APPROVED_PROFILE');
    }
    if (String(process.env.COUPON_NATIVE_POSTING_ENABLED || 'false').toLowerCase() !== 'false') {
      throw new Error('Native posting must remain disabled during rehearsal');
    }
  }
}

function connectionConfig(profile, env = process.env) {
  const local = profile === 'local_rehearsal';
  const prefix = local ? 'LOCAL_REHEARSAL_' : 'REMOTE_B_DB_';
  const approved = local ? APPROVED_LOCAL_REHEARSAL_TARGET : APPROVED_TARGET;
  // A separate structured config avoids opaque connection-string overrides and parser pollution.
  if (local && env.LOCAL_REHEARSAL_CONNECTION_STRING) throw new Error('Rehearsal CLI requires separate connection fields');
  const server = env[prefix + 'SERVER'];
  const database = env[prefix + (local ? 'DB' : 'NAME')];
  const user = env[prefix + 'USER'];
  const password = env[prefix + 'PASSWORD'];
  if (!server || database !== approved.dbName || user !== (local ? approved.migratorLogin : approved.loginName) || !password) {
    throw new Error('Missing or unapproved rehearsal connection fields');
  }
  if (local && server.toLowerCase() !== approved.serverName.toLowerCase()) throw new Error('Unapproved local rehearsal server');
  if (!local && server !== env.REHEARSAL_APPROVED_REMOTE_HOST) throw new Error('Remote endpoint requires explicit approved host');
  const config = { server, database, user, password, pool: { max: 10, min: 0, idleTimeoutMillis: 1000 }, requestTimeout: 120000 };
  if (local) {
    // Explicit shared-memory transport; native ODBC driver handles Windows named instances.
    const quote = value => '{' + String(value).replace(/}/g, '}}') + '}';
    return { connectionString: `Driver={SQL Server Native Client 10.0};Server=${quote('lpc:' + server)};Database=${quote(database)};Uid=${quote(user)};Pwd=${quote(password)};`, pool: config.pool, requestTimeout: config.requestTimeout };
  }
  const port = Number(env.REMOTE_B_DB_PORT || 1433);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid remote port');
  return { ...config, port, options: { encrypt: true, trustServerCertificate: env.REHEARSAL_TRUST_SERVER_CERTIFICATE === 'true' } };
}

async function withSession(options, profile, action) {
  authorize(options, profile);
  let pool;
  try {
    if (options.mode === 'mock') {
      pool = require('./rehearsal-test-helper.cjs').createRehearsalMockPool(profile, options.mockHandlers);
    } else {
      const config = connectionConfig(profile);
      const driver = options.driverFactory || (cfg => new (require(profile === 'local_rehearsal' ? 'mssql/msnodesqlv8' : 'mssql').ConnectionPool)(cfg));
      pool = driver(config);
      await pool.connect();
    }
    const verified = await runner.verifyTargetAndProfile(pool, profile);
    const result = await action(pool, verified);
    return { ...result, mode: options.mode, evidence: options.mode === 'mock' ? 'OFFLINE_MOCK_ONLY' : options.driverFactory ? 'OFFLINE_INJECTED_DRIVER' : 'ENGINE_EXECUTED' };
  } finally {
    if (pool) await pool.close();
  }
}

function query(pool, text, params = {}) {
  const request = pool.request();
  for (const [key, p] of Object.entries(params)) request.input(key, p.type, p.value);
  return request.query(text);
}

function cli(fn) {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--(mode|step|profile|baseline|backup-sha256|output)=(.+)$/.exec(arg);
    if (!match) { console.error('Unknown rehearsal argument'); process.exitCode = 1; return; }
    options[match[1] === 'backup-sha256' ? 'backupSha256' : match[1]] = match[2];
  }
  if (options.output) {
    const fs = require('fs'), path = require('path');
    const root = path.resolve(__dirname, '../../docs/sale-app/qa');
    const dest = path.resolve(options.output);
    const relative = path.relative(root, dest);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.existsSync(dest) || !fs.existsSync(path.dirname(dest))) {
      console.error('Output requires a new file within existing private docs/sale-app/qa directory'); process.exitCode = 1; return;
    }
  }
  fn(options).then(result => {
    if (options.output) require('fs').writeFileSync(options.output, JSON.stringify(result, null, 2), { flag: 'wx' });
    else console.log(JSON.stringify(result, null, 2));
    if (result.success === false || result.report?.success === false) process.exitCode = 1;
  }).catch(error => {
    // Driver errors may contain credentials; retain only safe machine-readable status.
    console.error('Rehearsal failed; inspect restricted diagnostics. Code:', /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'REHEARSAL_FAILED');
    process.exitCode = 1;
  });
}
module.exports = { authorize, connectionConfig, withSession, query, cli };
