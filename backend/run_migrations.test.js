'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sha256, splitBatches, validateMigrationPolicy, classifyMigration, buildPlan } = require('./run_migrations');

const basePolicy = () => ({
  schemaVersion: 1,
  checksumPolicy: 'immutable-after-apply',
  excludedFiles: ['000_manual.sql'],
  excludedPatterns: ['^uat_'],
  legacyDuplicateSequences: { 2: ['002_a.sql', '002_b.sql'] },
});

test('policy admits only the exact approved legacy duplicate group and excludes UAT SQL', () => {
  const result = validateMigrationPolicy([
    '000_manual.sql', '001_schema.sql', '002_a.sql', '002_b.sql', 'uat_create_admin.sql',
  ], basePolicy());
  assert.deepEqual(result.activeFiles, ['001_schema.sql', '002_a.sql', '002_b.sql']);
  assert.deepEqual(result.excludedFiles, ['000_manual.sql', 'uat_create_admin.sql']);
});

test('policy rejects an unexpected duplicate sequence', () => {
  assert.throws(() => validateMigrationPolicy([
    '000_manual.sql', '002_a.sql', '002_b.sql', '003_a.sql', '003_b.sql',
  ], basePolicy()), /sequence 3/);
});

test('policy rejects an unsequenced active SQL file', () => {
  assert.throws(() => validateMigrationPolicy([
    '000_manual.sql', '002_a.sql', '002_b.sql', 'manual_fix.sql',
  ], basePolicy()), /must start with a numeric sequence/);
});

test('migration classification is fail-closed for checksum and batch drift', () => {
  assert.equal(classifyMigration(null, 'abc', 2), 'PENDING');
  assert.equal(classifyMigration({ checksum: 'ABC', batchCount: 2 }, 'abc', 2), 'UNCHANGED');
  assert.equal(classifyMigration({ checksum: 'def', batchCount: 2 }, 'abc', 2), 'CHECKSUM_DRIFT');
  assert.equal(classifyMigration({ checksum: 'abc', batchCount: 1 }, 'abc', 2), 'BATCHCOUNT_DRIFT');
});

test('buildPlan identifies pending, excluded-applied, and ledger-only rows without database writes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-migrations-'));
  try {
    fs.writeFileSync(path.join(directory, '000_manual.sql'), 'SELECT 0;', 'utf8');
    fs.writeFileSync(path.join(directory, '001_a.sql'), 'SELECT 1;\nGO\nSELECT 2;', 'utf8');
    fs.writeFileSync(path.join(directory, '002_b.sql'), 'SELECT 3;', 'utf8');
    const inventory = {
      allFiles: ['000_manual.sql', '001_a.sql', '002_b.sql'],
      activeFiles: ['001_a.sql', '002_b.sql'],
      excludedFiles: ['000_manual.sql'],
    };
    const firstSql = fs.readFileSync(path.join(directory, '001_a.sql'), 'utf8');
    const applied = new Map([
      ['000_manual.sql', { checksum: 'legacy', batchCount: 1 }],
      ['001_a.sql', { checksum: sha256(firstSql), batchCount: splitBatches(firstSql).length }],
      ['removed.sql', { checksum: 'old', batchCount: 1 }],
    ]);
    const plan = buildPlan(inventory, applied, directory);
    assert.deepEqual(plan.entries.map(entry => [entry.file, entry.status]), [
      ['001_a.sql', 'UNCHANGED'],
      ['002_b.sql', 'PENDING'],
    ]);
    assert.deepEqual(plan.excludedApplied, ['000_manual.sql']);
    assert.deepEqual(plan.ledgerOnly, ['removed.sql']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const { loadApplied } = require('./run_migrations');
test('fresh database plan accepts proven absent ledger without issuing writes', async () => {
 const statements=[]; const pool={request:()=>({query:async q=>{statements.push(q);return {recordset:[{LedgerId:null,CanInspect:1}]};}})};
 assert.equal((await loadApplied(pool)).size,0);assert.equal(statements.length,1);assert.match(statements[0],/^SELECT /);
});
test('ledger invisibility and read failure cannot look like a fresh database', async () => {
 await assert.rejects(loadApplied({request:()=>({query:async()=>({recordset:[{LedgerId:null,CanInspect:0}]})})}),/VIEW DEFINITION/);
 await assert.rejects(loadApplied({request:()=>({query:async()=>{throw new Error('read denied');}})}),/read denied/);
});

const { executionBatches } = require('./run_migrations');
test('only checksum-pinned legacy context directive is removed; arbitrary cross-database SQL fails', () => {
 const text='USE dbwins_worldfert9; -- legacy\nSELECT DB_NAME();';
 const overrides={'074.sql':{checksum:sha256(text),database:'dbwins_worldfert9'}};
 assert.doesNotMatch(executionBatches('074.sql',text,'dbwins_worldfert9_test_v2',overrides).join(''),/^USE /m);
 assert.throws(()=>executionBatches('other.sql',text,'dbwins_worldfert9_test_v2',overrides),/USE/);
 assert.throws(()=>executionBatches('074.sql',text+' ', 'dbwins_worldfert9_test_v2',overrides),/checksum/);
});

const { runFile } = require('./run_migrations');
test('temporary-table batches share one transaction and batch scope', async () => {
 const events=[];const session={begin:async()=>events.push('begin'),commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),request:()=>({batch:async text=>events.push(text)})};
 const batches=['CREATE TABLE #Known (Id int);','SELECT * FROM #Known;','DROP TABLE #Known;'];
 const result=await runFile({transaction:()=>session,request:()=>{throw Error('Pooled query loses temp scope');}},'fixture.sql',batches);
 assert.deepEqual(events,['begin',...batches,'commit']);assert.equal(result.successCount,3);
});
test('temporary-table batch failure rolls back and cannot report migration success', async () => {
 const events=[];const session={begin:async()=>events.push('begin'),commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),request:()=>({batch:async()=>{throw Error('bad SQL');}})};
 await assert.rejects(runFile({transaction:()=>session},'fixture.sql',['CREATE TABLE #Known (Id int);']),/bad SQL/);
 assert.deepEqual(events,['begin','rollback']);
});

const { run } = require('./run_migrations');

function createRunnerMockPool(options = {}) {
  const targetRecord = {
    dbName: 'dbwins_worldfert9_local_uat',
    serverName: 'AMYOU-YOGA7\\V2008R2',
    productVersion: '10.50.1600.1',
    loginName: 'wf_uat_migrator',
    originalLogin: 'wf_uat_migrator',
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    prodAccess: 0,
    otherUserDbCount: 0,
    netTransport: 'Shared memory',
  };

  const executedQueries = [];
  const executedBatches = [];
  let transactionCreated = false;

  const makeReq = () => {
    const req = {
      input: () => req,
      query: async (sqlText) => {
        executedQueries.push(sqlText);
        if (/SELECT\s+DB_NAME\(\)/i.test(sqlText)) {
          return { recordset: [targetRecord] };
        }
        if (/SELECT\s+OBJECT_ID\('wf\.SchemaMigration'/i.test(sqlText)) {
          return { recordset: [{ LedgerId: null, CanInspect: 1 }] };
        }
        if (/FROM\s+wf\.SchemaMigration/i.test(sqlText)) {
          return { recordset: options.ledgerRows || [] };
        }
        if (options.queryHandler) {
          return options.queryHandler(sqlText);
        }
        return { recordset: [] };
      },
      batch: async (text) => {
        executedBatches.push(text);
        if (options.batchHandler) {
          return options.batchHandler(text);
        }
        return { rowsAffected: [1] };
      }
    };
    return req;
  };

  const pool = {
    executedQueries,
    executedBatches,
    get transactionCreated() { return transactionCreated; },
    request: makeReq,
    transaction: () => {
      transactionCreated = true;
      return {
        begin: async () => {},
        commit: async () => {},
        rollback: async () => {},
        request: makeReq,
      };
    }
  };
  return pool;
}

test('runner propagates WfRefSeq bootstrap failure, preserves committed migration ledger, and does not report success', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mig-test-'));
  try {
    fs.writeFileSync(path.join(directory, '000_logins.sql'), '-- login exclusion\n', 'utf8');
    fs.writeFileSync(path.join(directory, '001_initial.sql'), 'SELECT 1;', 'utf8');
    fs.writeFileSync(path.join(directory, '074_fix_winspeed_legacy_raiserror.sql'), '-- raiserror exclusion\n', 'utf8');
    const pool = createRunnerMockPool();
    const runnerOptions = {
      migrationsDir: directory,
      bootstrapSequenceHighWater: async (_, seqName) => {
        if (seqName === 'WfRefSeq') {
          throw new Error('Injected WfRefSeq bootstrap failure (e.g. table lock timeout)');
        }
      }
    };

    let thrownError = null;
    try {
      await run({ profile: 'local_uat', plan: false }, pool, null, runnerOptions);
    } catch (err) {
      thrownError = err;
    }

    assert.ok(thrownError, 'run() must throw when WfRefSeq bootstrap fails');
    assert.equal(thrownError.code, 'SEQUENCE_BOOTSTRAP_FAILURE');
    assert.equal(thrownError.sequence, 'WfRefSeq');
    assert.equal(thrownError.activeProfile, 'local_uat');
    assert.equal(thrownError.targetDatabase, 'dbwins_worldfert9_local_uat');
    assert.equal(thrownError.incomplete, true);
    // Preserves committed ledger entries: 001_initial.sql was committed before bootstrap failed
    assert.deepEqual(thrownError.appliedList, ['001_initial.sql']);
    assert.match(thrownError.message, /Post-migration sequence bootstrap failed for WfRefSeq/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('runner propagates QuoteRefSeq bootstrap failure, preserves committed migration ledger, and does not report success', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mig-test-'));
  try {
    fs.writeFileSync(path.join(directory, '000_logins.sql'), '-- login exclusion\n', 'utf8');
    fs.writeFileSync(path.join(directory, '001_initial.sql'), 'SELECT 1;', 'utf8');
    fs.writeFileSync(path.join(directory, '074_fix_winspeed_legacy_raiserror.sql'), '-- raiserror exclusion\n', 'utf8');
    const pool = createRunnerMockPool();
    const runnerOptions = {
      migrationsDir: directory,
      bootstrapSequenceHighWater: async (_, seqName) => {
        if (seqName === 'QuoteRefSeq') {
          throw new Error('Injected QuoteRefSeq bootstrap failure (e.g. conversion error)');
        }
      }
    };

    let thrownError = null;
    try {
      await run({ profile: 'local_uat', plan: false }, pool, null, runnerOptions);
    } catch (err) {
      thrownError = err;
    }

    assert.ok(thrownError, 'run() must throw when QuoteRefSeq bootstrap fails');
    assert.equal(thrownError.code, 'SEQUENCE_BOOTSTRAP_FAILURE');
    assert.equal(thrownError.sequence, 'QuoteRefSeq');
    assert.equal(thrownError.activeProfile, 'local_uat');
    assert.equal(thrownError.targetDatabase, 'dbwins_worldfert9_local_uat');
    assert.equal(thrownError.incomplete, true);
    assert.deepEqual(thrownError.appliedList, ['001_initial.sql']);
    assert.match(thrownError.message, /Post-migration sequence bootstrap failed for QuoteRefSeq/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('runner --plan is strictly read-only: no transactions, no ledger writes, no sequence bootstrap', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mig-test-'));
  try {
    fs.writeFileSync(path.join(directory, '000_logins.sql'), '-- login exclusion\n', 'utf8');
    fs.writeFileSync(path.join(directory, '001_initial.sql'), 'SELECT 1;', 'utf8');
    fs.writeFileSync(path.join(directory, '074_fix_winspeed_legacy_raiserror.sql'), '-- raiserror exclusion\n', 'utf8');
    const pool = createRunnerMockPool();
    let bootstrapCalled = false;
    const runnerOptions = {
      migrationsDir: directory,
      bootstrapSequenceHighWater: async () => {
        bootstrapCalled = true;
      }
    };

    const result = await run({ plan: true, profile: 'local_uat' }, pool, null, runnerOptions);
    assert.ok(result);
    assert.equal(result.targetProfile, 'local_uat');
    assert.equal(result.counts.PENDING, 1);
    assert.equal(pool.transactionCreated, false, 'plan mode must never create transactions');
    assert.equal(pool.executedBatches.length, 0, 'plan mode must never execute batches');
    assert.equal(bootstrapCalled, false, 'plan mode must never invoke bootstrap');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

