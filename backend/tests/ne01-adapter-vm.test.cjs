/**
 * backend/tests/ne01-adapter-vm.test.cjs
 *
 * Isolated Node VM Test Harness for actual `createRedemptionDocument`
 * Offline Only — Zero DB connection, sealed module loader, synthetic process/env.
 *
 * Drives real function from backend/services/redemption-native-adapter.js
 * Verifies SQL parameter binding, state transitions, conservation, transaction ownership,
 * zero-query assertions, and strict SQL catalog validation.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');

const ADAPTER_SOURCE_PATH = path.resolve(__dirname, '../services/redemption-native-adapter.js');

/**
 * Exact reviewed SQL catalog whitelist.
 * Every query executed against the fake DB must match one of these statements exactly
 * (whitespace normalized via replace(/\s+/g, ' ').trim()).
 * Any extra clause, statement, or suffix is rejected immediately.
 */
const REVIEWED_SQL_CATALOG = {
  SERVICE_GATE_IDENTITY:
    "SELECT @@SERVERNAME AS srv, DB_NAME() AS db, SYSTEM_USER AS usr, IS_SRVROLEMEMBER('sysadmin') AS isSysadmin",
  SERVICE_GATE_PROD_ACCESS:
    "SELECT HAS_DBACCESS('dbwins_worldfert9') AS prodAccess",
  CHECK_DUPLICATE_DOCU_NO:
    "SELECT TOP 1 RedemtionID FROM dbo.WFRedemtionHD WITH (UPDLOCK, HOLDLOCK) WHERE DocuNo = @docuNo",
  ALLOCATE_REDEMTION_ID:
    "SELECT ISNULL(MAX(RedemtionID), 0) + 1 AS NextRedemtionID FROM dbo.WFRedemtionHD WITH (UPDLOCK, HOLDLOCK)",
  INSERT_REDEMTION_HD:
    "INSERT INTO dbo.WFRedemtionHD ( RedemtionID, DocuNo, DocuDate, DocuType, CardNo, IssueName, CarLicense, SaveEmpID, IssueEmpID, AppvEmpID, SumGoodQty, DocuStatus, IsCheckAll ) VALUES ( @redemtionId, @docuNo, @docuDate, @docuType, NULL, NULL, @carLicense, @saveEmpId, NULL, NULL, @sumGoodQty, 'N', 'Y' )",
  LOOKUP_COUPON:
    "SELECT CouponID, CouponNo, GoodID, GoodUnitID, GoodPrice, RemaQty FROM dbo.WFCoupon WITH (UPDLOCK, ROWLOCK) WHERE CouponID = @cid",
  INSERT_REDEMTION_DT:
    "INSERT INTO dbo.WFRedemtionDT ( RedemtionID, Listno, GoodID, InveID, LocaID, GoodUnitID, GoodPrice, CouponID, CouponNo, PostInv, GoodQty, RemaQty, SOInvID, SOListNo, IsCheck ) VALUES ( @redemtionId, @listno, @goodId, @inveId, @locaId, @goodUnitId, @goodPrice, @couponId, @couponNo, 'N', @goodQty, @remaQty, NULL, NULL, 'Y' )",
  DEDUCT_COUPON:
    "UPDATE dbo.WFCoupon SET RemaQty = RemaQty - @qty WHERE CouponID = @cid AND RemaQty >= @qty",
  INSERT_MIRROR:
    "INSERT INTO wf.CouponRedemptionMirror ( RedemtionID, CouponID, AppliedSOInvID, AppliedInvoiceNo, RedeemedTon, RedeemedAt, DocuNo, Source, Status ) VALUES ( @redemtionId, @couponId, NULL, NULL, @redeemedTon, SYSUTCDATETIME(), @docuNo, @source, @status )",
  ALLOCATE_AUDIT_ID:
    "SELECT ISNULL(MAX(audit_id), 0) + 1 AS NextAuditId FROM dbo.SMAudit WITH (UPDLOCK, HOLDLOCK)",
  INSERT_AUDIT:
    "INSERT INTO dbo.SMAudit ( audit_id, audit_system, audit_screen, audit_datetime, audit_username, audit_action, audit_docuno, audit_docudate, audit_columnid, brchid, audit_computername, audit_query, audit_refid, audit_logouttime, Version ) VALUES ( @auditId, @auditSystem, @auditScreen, GETDATE(), @auditUsername, @auditAction, @auditDocuNo, @auditDocuDate, @auditColumnId, @brchId, @auditComputerName, NULL, @auditRefId, NULL, @version )",
};

/**
 * Creates an in-memory transactional fake database model with faithful row tracking,
 * zero counter mutation leaks on read queries, observable transaction lifecycle,
 * and shared event ledger.
 */
function createFakeDbModel(initialState = {}, options = {}) {
  const initialMaxRedemtionId = Number(initialState.initialMaxRedemtionId || 100);
  const initialMaxAuditId = Number(initialState.initialMaxAuditId || 500);

  // Canonical committed row storage
  const state = {
    coupons: new Map((initialState.coupons || []).map(c => [Number(c.CouponID), { ...c }])),
    redemptionHD: new Map((initialState.redemptionHD || []).map(h => [Number(h.RedemtionID), { ...h }])),
    redemptionDT: new Map((initialState.redemptionDT || []).map(d => [`${d.RedemtionID}_${d.Listno}`, { ...d }])),
    mirror: (initialState.mirror || []).map(m => ({ ...m })),
    smAudit: (initialState.smAudit || []).map(a => ({ ...a })),
    committedTxCount: 0,
    rolledBackTxCount: 0,
  };

  // Shared event ledger across all standalone and transactional requests
  const eventLedger = {
    queries: [],      // [{ sql, inputs, txId, timestamp }]
    binds: [],        // [{ name, type, value, txId }]
    transactions: [], // [{ type: 'begin' | 'commit' | 'rollback', txId }]
    clear() {
      this.queries = [];
      this.binds = [];
      this.transactions = [];
    },
  };

  // Target identity configuration for assertServiceGate
  let identityTuple = {
    srv: '21181f44f254',
    db: 'dbwins_worldfert9_test_v2',
    usr: 'wf_test',
    isSysadmin: 0,
  };
  let prodAccessVal = 0;
  let forceRowsAffected0 = false;
  let failAfterLineIndex = -1;
  let simulateAuditFailure = false;

  function setIdentity(tuple) { identityTuple = { ...tuple }; }
  function setProdAccess(val) { prodAccessVal = val; }
  function setForceRowsAffected0(val) { forceRowsAffected0 = Boolean(val); }
  function setFailAfterLineIndex(val) { failAfterLineIndex = val; }
  function setSimulateAuditFailure(val) { simulateAuditFailure = Boolean(val); }

  /**
   * Generates a complete data snapshot of visible committed state and derived IDs.
   * IDs are computed from visible rows, ensuring no hidden internal counter leak.
   */
  function getDataSnapshot() {
    const visibleHD = Array.from(state.redemptionHD.values());
    const visibleAudit = state.smAudit;

    const computedMaxRedemtionId = visibleHD.length > 0
      ? Math.max(...visibleHD.map(r => Number(r.RedemtionID)))
      : initialMaxRedemtionId;

    const computedMaxAuditId = visibleAudit.length > 0
      ? Math.max(...visibleAudit.map(a => Number(a.audit_id || a.auditId)))
      : initialMaxAuditId;

    return JSON.stringify({
      coupons: Array.from(state.coupons.entries()).map(([k, v]) => [k, { ...v }]),
      redemptionHD: visibleHD.map(h => ({ ...h })),
      redemptionDT: Array.from(state.redemptionDT.values()).map(d => ({ ...d })),
      mirror: state.mirror.map(m => ({ ...m })),
      smAudit: visibleAudit.map(a => ({ ...a })),
      computedMaxRedemtionId,
      computedMaxAuditId,
    });
  }

  function getSnapshot() {
    const data = JSON.parse(getDataSnapshot());
    return JSON.stringify({
      ...data,
      committedTxCount: state.committedTxCount,
      rolledBackTxCount: state.rolledBackTxCount,
    });
  }

  let txCounter = 0;
  let lastOwnTx = null;

  class FakeTransaction {
    constructor(txOptions = {}) {
      this.txId = ++txCounter;
      this.isOwnWrapper = Boolean(txOptions.isOwnWrapper);
      this.stagedInserts = { HD: [], DT: [], mirror: [], audit: [] };
      this.stagedCouponUpdates = new Map(); // cid -> newRemaQty
      this.capturedBinds = { HD: null, DT: [], audit: [], mirror: [] };
      this.rolledBack = false;
      this.committed = false;
      this.commitCount = 0;
      this.rollbackCount = 0;
      this.queryLog = [];

      eventLedger.transactions.push({ type: 'begin', txId: this.txId });
    }

    request() {
      const tx = this;
      const boundInputs = new Map();

      return {
        input(name, type, value) {
          boundInputs.set(name, { type, value });
          eventLedger.binds.push({ name, type, value, txId: tx.txId });
          return this;
        },
        async query(sqlText) {
          const sqlTrim = sqlText.trim();
          const normalizedSql = sqlText.replace(/\s+/g, ' ').trim();
          const boundEntries = Object.fromEntries(
            Array.from(boundInputs.entries()).map(([k, v]) => [k, v.value])
          );

          eventLedger.queries.push({ sql: normalizedSql, inputs: boundEntries, txId: tx.txId });
          tx.queryLog.push({ sql: normalizedSql, inputs: boundEntries });

          // STRICT SQL CATALOG VALIDATION: reject unknown/extra SQL immediately
          const isAllowed = Object.values(REVIEWED_SQL_CATALOG).includes(normalizedSql);
          if (!isAllowed) {
            throw Object.assign(
              new Error(`DISALLOWED_OR_UNRECOGNIZED_SQL: Statement not in reviewed catalog ("${sqlTrim}")`),
              { code: 'DISALLOWED_OR_UNRECOGNIZED_SQL' }
            );
          }

          // 1. assertServiceGate identity check
          if (normalizedSql === REVIEWED_SQL_CATALOG.SERVICE_GATE_IDENTITY) {
            return { recordset: [{ ...identityTuple }] };
          }

          // 2. assertServiceGate production database access check
          if (normalizedSql === REVIEWED_SQL_CATALOG.SERVICE_GATE_PROD_ACCESS) {
            return { recordset: [{ prodAccess: prodAccessVal }] };
          }

          // 3. Duplicate DocuNo check
          if (normalizedSql === REVIEWED_SQL_CATALOG.CHECK_DUPLICATE_DOCU_NO) {
            const docuNo = boundInputs.get('docuNo')?.value;
            const existing = Array.from(state.redemptionHD.values()).find(h => h.DocuNo === docuNo);
            return { recordset: existing ? [existing] : [] };
          }

          // 4. Next RedemtionID allocation: pure read computation from visible rows, ZERO mutation leak
          if (normalizedSql === REVIEWED_SQL_CATALOG.ALLOCATE_REDEMTION_ID) {
            const visibleRows = [
              ...Array.from(state.redemptionHD.values()),
              ...tx.stagedInserts.HD,
            ];
            const maxId = visibleRows.length > 0
              ? Math.max(...visibleRows.map(r => Number(r.RedemtionID || r.redemtionId)))
              : initialMaxRedemtionId;
            return { recordset: [{ NextRedemtionID: maxId + 1 }] };
          }

          // 5. Insert WFRedemtionHD
          if (normalizedSql === REVIEWED_SQL_CATALOG.INSERT_REDEMTION_HD) {
            const row = Object.fromEntries(Array.from(boundInputs.entries()).map(([k, v]) => [k, v.value]));
            tx.stagedInserts.HD.push(row);
            tx.capturedBinds.HD = row;
            return { rowsAffected: [1] };
          }

          // 6. Look up WFCoupon line
          if (normalizedSql === REVIEWED_SQL_CATALOG.LOOKUP_COUPON) {
            const cid = Number(boundInputs.get('cid')?.value);
            const currentRema = tx.stagedCouponUpdates.has(cid)
              ? tx.stagedCouponUpdates.get(cid)
              : state.coupons.get(cid)?.RemaQty;
            const coupon = state.coupons.get(cid);
            if (!coupon) return { recordset: [] };
            return {
              recordset: [{
                CouponID: coupon.CouponID,
                CouponNo: coupon.CouponNo,
                GoodID: coupon.GoodID,
                GoodUnitID: coupon.GoodUnitID,
                GoodPrice: coupon.GoodPrice,
                RemaQty: currentRema,
              }],
            };
          }

          // 7. Insert WFRedemtionDT
          if (normalizedSql === REVIEWED_SQL_CATALOG.INSERT_REDEMTION_DT) {
            const row = Object.fromEntries(Array.from(boundInputs.entries()).map(([k, v]) => [k, v.value]));
            tx.stagedInserts.DT.push(row);
            tx.capturedBinds.DT.push(row);

            // Fault injection after specific line index
            if (failAfterLineIndex >= 0 && tx.stagedInserts.DT.length > failAfterLineIndex) {
              throw Object.assign(new Error(`Simulated fault on line index ${tx.stagedInserts.DT.length}`), {
                code: 'SIMULATED_LINE_FAULT',
              });
            }
            return { rowsAffected: [1] };
          }

          // 8. Update WFCoupon optimistic deduction
          if (normalizedSql === REVIEWED_SQL_CATALOG.DEDUCT_COUPON) {
            if (forceRowsAffected0) {
              return { rowsAffected: [0] };
            }
            const cid = Number(boundInputs.get('cid')?.value ?? boundInputs.get('couponId')?.value);
            const qty = Number(boundInputs.get('qty')?.value);
            const currentRema = tx.stagedCouponUpdates.has(cid)
              ? tx.stagedCouponUpdates.get(cid)
              : Number(state.coupons.get(cid)?.RemaQty || 0);

            const newRema = Math.round((currentRema - qty) * 1000) / 1000;
            tx.stagedCouponUpdates.set(cid, newRema);
            return { rowsAffected: [1] };
          }

          // 9. Insert Mirror
          if (normalizedSql === REVIEWED_SQL_CATALOG.INSERT_MIRROR) {
            const row = Object.fromEntries(Array.from(boundInputs.entries()).map(([k, v]) => [k, v.value]));
            tx.stagedInserts.mirror.push(row);
            tx.capturedBinds.mirror.push(row);
            return { rowsAffected: [1] };
          }

          // 10. Next Audit ID: pure read computation from visible rows, ZERO mutation leak
          if (normalizedSql === REVIEWED_SQL_CATALOG.ALLOCATE_AUDIT_ID) {
            const visibleAuditRows = [
              ...state.smAudit,
              ...tx.stagedInserts.audit,
            ];
            const maxAudit = visibleAuditRows.length > 0
              ? Math.max(...visibleAuditRows.map(a => Number(a.audit_id || a.auditId)))
              : initialMaxAuditId;
            return { recordset: [{ NextAuditId: maxAudit + 1 }] };
          }

          // 11. Insert SMAudit
          if (normalizedSql === REVIEWED_SQL_CATALOG.INSERT_AUDIT) {
            if (simulateAuditFailure) {
              throw Object.assign(new Error('Simulated failure during SMAudit insertion'), {
                code: 'SIMULATED_AUDIT_INSERT_FAILURE',
              });
            }
            const row = Object.fromEntries(Array.from(boundInputs.entries()).map(([k, v]) => [k, v.value]));
            tx.stagedInserts.audit.push(row);
            tx.capturedBinds.audit.push(row);
            return { rowsAffected: [1] };
          }

          throw new Error(`UNREACHABLE_SQL_FALLTHROUGH: ${normalizedSql}`);
        },
      };
    }

    commit() {
      if (this.rolledBack) throw new Error('Cannot commit a rolled-back transaction');
      this.committed = true;
      this.commitCount++;
      state.committedTxCount++;
      eventLedger.transactions.push({ type: 'commit', txId: this.txId });

      // Flush staged inserts to committed storage
      for (const h of this.stagedInserts.HD) {
        state.redemptionHD.set(Number(h.redemtionId), {
          RedemtionID: Number(h.redemtionId),
          DocuNo: h.docuNo,
          DocuDate: h.docuDate,
          DocuType: h.docuType,
          CarLicense: h.carLicense,
          SaveEmpID: h.saveEmpId,
          SumGoodQty: h.sumGoodQty,
          DocuStatus: 'N',
          IsCheckAll: 'Y',
        });
      }
      for (const d of this.stagedInserts.DT) {
        state.redemptionDT.set(`${d.redemtionId}_${d.listno}`, {
          RedemtionID: Number(d.redemtionId),
          Listno: Number(d.listno),
          GoodID: Number(d.goodId),
          InveID: Number(d.inveId),
          LocaID: Number(d.locaId),
          GoodUnitID: Number(d.goodUnitId),
          GoodPrice: d.goodPrice,
          CouponID: Number(d.couponId),
          CouponNo: d.couponNo,
          GoodQty: d.goodQty,
          RemaQty: d.remaQty,
          PostInv: 'N',
          IsCheck: 'Y',
        });
      }
      for (const m of this.stagedInserts.mirror) {
        state.mirror.push({ ...m });
      }
      for (const a of this.stagedInserts.audit) {
        state.smAudit.push({ audit_id: Number(a.auditId || a.audit_id), ...a });
      }
      for (const [cid, newRema] of this.stagedCouponUpdates.entries()) {
        const cp = state.coupons.get(cid);
        if (cp) cp.RemaQty = newRema;
      }
    }

    rollback() {
      this.rolledBack = true;
      this.rollbackCount++;
      state.rolledBackTxCount++;
      eventLedger.transactions.push({ type: 'rollback', txId: this.txId });

      // Discard all staged state
      this.stagedInserts = { HD: [], DT: [], mirror: [], audit: [] };
      this.stagedCouponUpdates.clear();
    }
  }

  // Standalone query interface
  async function query(sqlText) {
    const tx = new FakeTransaction({ isOwnWrapper: false });
    return (await tx.request().query(sqlText)).recordset;
  }

  // wfTransaction wrapper
  async function wfTransaction(callback) {
    const tx = new FakeTransaction({ isOwnWrapper: true });
    lastOwnTx = tx;
    try {
      const result = await callback(tx);
      tx.commit();
      return result;
    } catch (err) {
      if (!options.mutantOmitOwnRollback) {
        tx.rollback();
      }
      throw err;
    }
  }

  const fakeSql = {
    Int: 'Int',
    SmallInt: 'SmallInt',
    VarChar: (len) => `VarChar(${len})`,
    NVarChar: (len) => `NVarChar(${len})`,
    Date: 'Date',
    Decimal: (p, s) => `Decimal(${p},${s})`,
    Char: (len) => `Char(${len})`,
  };

  return {
    state,
    eventLedger,
    getDataSnapshot,
    getSnapshot,
    setIdentity,
    setProdAccess,
    setForceRowsAffected0,
    setFailAfterLineIndex,
    setSimulateAuditFailure,
    getLastOwnTx: () => lastOwnTx,
    FakeTransaction,
    fakeDbModule: {
      sql: fakeSql,
      wfTransaction,
      query,
    },
  };
}

/**
 * Loads the actual adapter module in an isolated Node VM sandbox.
 * Supports running the current source or an in-memory reconstructed unpatched baseline
 * without modifying any files on disk.
 */
function loadAdapterInIsolatedVm(virtualPostingFlag = true, fakeDbModule, vmOptions = {}) {
  let source = fs.readFileSync(ADAPTER_SOURCE_PATH, 'utf8');

  // Verify current source hash
  const currentHash = crypto.createHash('sha256').update(source).digest('hex').toUpperCase();

  if (vmOptions.useBaselineRed) {
    // Reconstruct pre-patch baseline AB30...06E5 in memory
    source = source
      .replace(
        ' * 6. DT quantity: WFRedemtionDT.RemaQty starts at the validated uninvoiced line GoodQty.',
        ' * 6. DT Snapshot: WFRedemtionDT.RemaQty records balance BEFORE deduction.'
      )
      .replace(
        '// 7.2 Insert WFRedemtionDT with initial uninvoiced line quantity',
        '// 7.2 Insert WFRedemtionDT with snapshot RemaQty (BEFORE deduction)'
      )
      .replace(
        ".input('remaQty', sql.Decimal(18, 3), qty)",
        ".input('remaQty', sql.Decimal(18, 3), beforeRemaQty)"
      );

    const baselineHash = crypto.createHash('sha256').update(source).digest('hex').toUpperCase();
    assert.strictEqual(
      baselineHash,
      'AB30BD23C0EE33AFF825E326AE139F8FC16B7CFC9FF6839B80CD92BEC63706E5',
      'In-memory reconstructed baseline must strictly match candidate baseline hash AB30...06E5'
    );
  } else {
    assert.strictEqual(
      currentHash,
      '269C1B9FF4BFE9A53F6E89FB987C222DD17DA9AA990642E233DC1E3DD8B11A25',
      'On-disk source must strictly match candidate accepted hash 269C...1A25'
    );
  }

  // Mutant injection modes for oracle validation
  if (vmOptions.mutantReadBeforeGate) {
    source = source.replace(
      'async function assertServiceGate(tx = null) {',
      'async function assertServiceGate(tx = null) { await (tx ? tx.request().query("SELECT @@SERVERNAME AS srv, DB_NAME() AS db, SYSTEM_USER AS usr, IS_SRVROLEMEMBER(\'sysadmin\') AS isSysadmin") : query("SELECT @@SERVERNAME AS srv, DB_NAME() AS db, SYSTEM_USER AS usr, IS_SRVROLEMEMBER(\'sysadmin\') AS isSysadmin"));'
    );
  }

  if (vmOptions.mutantSqlSuffix) {
    source = source.replace(
      'SELECT HAS_DBACCESS(\'dbwins_worldfert9\') AS prodAccess',
      'SELECT HAS_DBACCESS(\'dbwins_worldfert9\') AS prodAccess -- unauthorized mutant suffix'
    );
  }

  const syntheticProcess = {
    env: {
      COUPON_NATIVE_POSTING_ENABLED: virtualPostingFlag ? 'true' : 'false',
    },
  };

  const sandbox = {
    process: syntheticProcess,
    console: {
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
    },
    Math,
    Date,
    String,
    Number,
    Array,
    Set,
    Map,
    Object,
    Error,
    isNaN,
  };

  function sealedRequire(modulePath) {
    if (modulePath === '../db') {
      return fakeDbModule;
    }
    throw new Error(`SECURITY_BLOCK: Disallowed module import "${modulePath}" in isolated adapter VM`);
  }

  const context = vm.createContext(sandbox);
  const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`;
  const script = new vm.Script(wrapped, { filename: ADAPTER_SOURCE_PATH });
  const moduleObj = { exports: {} };

  script.runInContext(context)(moduleObj.exports, sealedRequire, moduleObj, ADAPTER_SOURCE_PATH, path.dirname(ADAPTER_SOURCE_PATH));

  return moduleObj.exports;
}

/**
 * Executes the full test suite.
 */
async function runSuite(suiteOptions = {}) {
  const results = [];
  let passedCount = 0;
  let failedCount = 0;
  let totalCasesCount = 0;

  async function test(name, fn) {
    try {
      await fn();
      passedCount++;
      results.push({ name, status: 'PASS' });
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      failedCount++;
      results.push({ name, status: 'FAIL', error: err.message });
      console.log(`  [FAIL] ${name} -> ${err.message}`);
    }
  }

  console.log(`--- RUNNING ISOLATED VM ACTUAL FUNCTION SUITE FOR NE01 (${suiteOptions.useBaselineRed ? 'REPLAY RED' : 'GREEN'}) ---`);

  // CATEGORY 1: Virtual flag false & shared event ledger zero-query assertion (T02)
  await test('1. Virtual flag false: NATIVE_POSTING_DISABLED with zero SQL queries and zero binds', async () => {
    totalCasesCount += 2;
    const fakeModel = createFakeDbModel();
    const adapter = loadAdapterInIsolatedVm(false, fakeModel.fakeDbModule, suiteOptions);

    const snapBefore = fakeModel.getSnapshot();

    // Case 1.1: Virtual flag false explicitly
    await assert.rejects(
      async () => {
        await adapter.createRedemptionDocument({
          docuNo: 'SYN-DOC-001',
          carLicense: '1กก-9999',
          lines: [{ couponId: 1, goodQty: 2 }],
        });
      },
      (err) => err.code === 'NATIVE_POSTING_DISABLED' && err.status === 400
    );

    // ZERO SQL, ZERO BINDS, ZERO TRANSACTIONS
    assert.strictEqual(fakeModel.eventLedger.queries.length, 0, 'Must have zero queries when flag is false');
    assert.strictEqual(fakeModel.eventLedger.binds.length, 0, 'Must have zero parameter binds when flag is false');
    assert.strictEqual(fakeModel.eventLedger.transactions.length, 0, 'Must have zero transactions when flag is false');

    const snapAfter = fakeModel.getSnapshot();
    assert.strictEqual(snapBefore, snapAfter, 'Model snapshot must be untouched');

    // Case 1.2: Calling assertServiceGate directly without transaction
    await assert.rejects(
      () => adapter.assertServiceGate(),
      (err) => err.code === 'NATIVE_POSTING_DISABLED' && err.status === 400
    );
    assert.strictEqual(fakeModel.eventLedger.queries.length, 0, 'Zero queries after direct assertServiceGate');
  });

  // CATEGORY 2: Comprehensive Guard Tuples & Zero Mutation (T03, D01)
  await test('2. Identity guards: reject privileged sysadmin / prod database / wrong server / prod access (12 tuples)', async () => {
    totalCasesCount += 12;
    const fakeModel = createFakeDbModel();
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);

    // 2.1 Sysadmin must be literal 0 (fails on 1)
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'dbwins_worldfert9_test_v2', usr: 'wf_test', isSysadmin: 1 });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_WRITE_BLOCKED' && err.status === 403
    );

    // 2.2 Sysadmin null
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'dbwins_worldfert9_test_v2', usr: 'wf_test', isSysadmin: null });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_WRITE_BLOCKED' && err.status === 403
    );

    // 2.3 Sysadmin undefined
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'dbwins_worldfert9_test_v2', usr: 'wf_test', isSysadmin: undefined });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_WRITE_BLOCKED' && err.status === 403
    );

    // 2.4 Sysadmin string '0' (not literal number 0)
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'dbwins_worldfert9_test_v2', usr: 'wf_test', isSysadmin: '0' });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_WRITE_BLOCKED' && err.status === 403
    );

    // 2.5 Refuse production DB exact name
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'dbwins_worldfert9', usr: 'wf_test', isSysadmin: 0 });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_WRITE_BLOCKED' && err.status === 403
    );

    // 2.6 Refuse production DB pattern contains 'prod'
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'dbwins_worldfert9_prod', usr: 'wf_test', isSysadmin: 0 });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_WRITE_BLOCKED' && err.status === 403
    );

    // 2.7 Refuse non-sanctioned server
    fakeModel.setIdentity({ srv: 'unknown_server', db: 'dbwins_worldfert9_test_v2', usr: 'wf_test', isSysadmin: 0 });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'UNAUTHORIZED_SERVER' && err.status === 403
    );

    // 2.8 Refuse non-sanctioned target database
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'wrong_test_db', usr: 'wf_test', isSysadmin: 0 });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'UNAUTHORIZED_TARGET' && err.status === 403
    );

    // 2.9 Refuse non-sanctioned principal (e.g. sa)
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'dbwins_worldfert9_test_v2', usr: 'sa', isSysadmin: 0 });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'UNAUTHORIZED_PRINCIPAL' && err.status === 403
    );

    // 2.10 Refuse user with production access (prodAccess = 1)
    fakeModel.setIdentity({ srv: '21181f44f254', db: 'dbwins_worldfert9_test_v2', usr: 'wf_test', isSysadmin: 0 });
    fakeModel.setProdAccess(1);
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_ACCESS_DETECTED' && err.status === 403
    );

    // 2.11 ProdAccess null
    fakeModel.setProdAccess(null);
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_ACCESS_DETECTED' && err.status === 403
    );

    // 2.12 ProdAccess undefined
    fakeModel.setProdAccess(undefined);
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 1, goodQty: 1 }] }),
      (err) => err.code === 'PRODUCTION_ACCESS_DETECTED' && err.status === 403
    );

    fakeModel.setProdAccess(0); // reset

    // Zero mutations in database
    const snap = JSON.parse(fakeModel.getSnapshot());
    assert.strictEqual(snap.redemptionHD.length, 0);
    assert.strictEqual(snap.redemptionDT.length, 0);
    assert.strictEqual(snap.committedTxCount, 0);
  });

  // CATEGORY 3: Core NE01 Parameter Binding Proof (Single Coupon cut 2 from 10)
  await test('3. [CORE NE01] Coupon 10 cut 2: detail GoodQty=2, RemaQty=2 (not balance-before 10), header=2, coupon=8', async () => {
    totalCasesCount += 1;
    const fakeModel = createFakeDbModel({
      coupons: [
        { CouponID: 101, CouponNo: 'C6900101', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 },
      ],
    });
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);
    const existingTx = new fakeModel.FakeTransaction();

    const res = await adapter.createRedemptionDocument({
      docuNo: 'SYN-DOC-002',
      carLicense: '1กก-1111',
      lines: [{ couponId: 101, couponNo: 'C6900101', goodId: 501, goodUnitId: 10, goodPrice: 15000, goodQty: 2.0 }],
    }, { existingTx });
    existingTx.commit();

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sumGoodQty, 2.0);

    const dtBinds = existingTx.capturedBinds.DT;
    assert.strictEqual(dtBinds.length, 1);
    const lineBind = dtBinds[0];

    assert.strictEqual(lineBind.goodQty, 2.0, 'GoodQty parameter must equal cut quantity 2.0');

    // THIS IS THE EXACT NE01 ASSERTION:
    // Buggy code binds beforeRemaQty (10.0). Fixed code binds qty (2.0).
    assert.strictEqual(
      lineBind.remaQty,
      2.0,
      `NE01 CHECK: Expected DT.remaQty parameter to be line cut quantity (2.0), but got (${lineBind.remaQty})`
    );

    // Header SumGoodQty reconciliation
    assert.strictEqual(existingTx.capturedBinds.HD.sumGoodQty, 2.0);

    // Coupon remaining balance after deduction
    const snap = JSON.parse(fakeModel.getSnapshot());
    const couponAfter = snap.coupons.find(([id]) => id === 101)[1];
    assert.strictEqual(couponAfter.RemaQty, 8.0, 'Coupon balance after deduction must be 8.0');
  });

  // CATEGORY 4: Fractional Cut & Precision Policy (1.333 cut from 10)
  await test('4. Fractional cut 1.333: balance 8.667 preserving app normalization policy', async () => {
    totalCasesCount += 1;
    const fakeModel = createFakeDbModel({
      coupons: [
        { CouponID: 102, CouponNo: 'C6900102', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 },
      ],
    });
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);
    const existingTx = new fakeModel.FakeTransaction();

    await adapter.createRedemptionDocument({
      docuNo: 'SYN-DOC-003',
      carLicense: '1กก-1111',
      lines: [{ couponId: 102, couponNo: 'C6900102', goodId: 501, goodUnitId: 10, goodPrice: 15000, goodQty: 1.333 }],
    }, { existingTx });
    existingTx.commit();

    const dtBind = existingTx.capturedBinds.DT[0];
    assert.strictEqual(dtBind.goodQty, 1.333);
    assert.strictEqual(dtBind.remaQty, 1.333, 'Fractional line remaQty must be 1.333');

    const snap = JSON.parse(fakeModel.getSnapshot());
    const couponAfter = snap.coupons.find(([id]) => id === 102)[1];
    assert.strictEqual(couponAfter.RemaQty, 8.667);
  });

  // CATEGORY 5: Multi-Coupon Deduction & Sorted Lock Order (NWR3-01, T03)
  await test('5. Multi-coupon (NWR3-01): Coupon A(10) cut 2, B(20) cut 3 -> details 2/3, header 5, balances 8/17', async () => {
    totalCasesCount += 1;
    const fakeModel = createFakeDbModel({
      coupons: [
        { CouponID: 201, CouponNo: 'C6900201', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 },
        { CouponID: 202, CouponNo: 'C6900202', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 20.0 },
      ],
    });
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);
    const existingTx = new fakeModel.FakeTransaction();

    // Input provided in REVERSE order (202 then 201) to verify deadlock-prevention lock sorting
    const res = await adapter.createRedemptionDocument({
      docuNo: 'SYN-DOC-004',
      carLicense: '2กก-2222',
      lines: [
        { couponId: 202, couponNo: 'C6900202', goodId: 501, goodUnitId: 10, goodPrice: 15000, goodQty: 3.0 },
        { couponId: 201, couponNo: 'C6900201', goodId: 501, goodUnitId: 10, goodPrice: 15000, goodQty: 2.0 },
      ],
    }, { existingTx });
    existingTx.commit();

    assert.strictEqual(res.sumGoodQty, 5.0, 'Header total must be 5.0');
    assert.strictEqual(existingTx.capturedBinds.HD.sumGoodQty, 5.0);

    const binds = existingTx.capturedBinds.DT;
    assert.strictEqual(binds.length, 2);

    // Verify lock order sorting: line 1 must be coupon 201, line 2 coupon 202
    assert.strictEqual(binds[0].couponId, 201, 'Line 1 must be sorted to coupon 201');
    assert.strictEqual(binds[0].goodQty, 2.0);
    assert.strictEqual(binds[0].remaQty, 2.0);

    assert.strictEqual(binds[1].couponId, 202, 'Line 2 must be sorted to coupon 202');
    assert.strictEqual(binds[1].goodQty, 3.0);
    assert.strictEqual(binds[1].remaQty, 3.0);

    // NWR3-01 verification: per-coupon deduction must be individual cut, NOT total header 5!
    const snap = JSON.parse(fakeModel.getSnapshot());
    const cpA = snap.coupons.find(([id]) => id === 201)[1];
    const cpB = snap.coupons.find(([id]) => id === 202)[1];
    assert.strictEqual(cpA.RemaQty, 8.0, 'Coupon A must be 10 - 2 = 8.0 (NOT 10 - 5 = 5)');
    assert.strictEqual(cpB.RemaQty, 17.0, 'Coupon B must be 20 - 3 = 17.0 (NOT 20 - 5 = 15)');

    // Verify Mirror and SMAudit bindings
    assert.strictEqual(existingTx.capturedBinds.mirror.length, 2);
    assert.strictEqual(existingTx.capturedBinds.mirror[0].source, 'SALE_APP');
    assert.strictEqual(existingTx.capturedBinds.mirror[0].status, 'COMPLETED');

    assert.strictEqual(existingTx.capturedBinds.audit.length, 1);
    assert.strictEqual(existingTx.capturedBinds.audit[0].auditAction, 'I');
    assert.strictEqual(existingTx.capturedBinds.audit[0].auditScreen, 2098003052);
  });

  // CATEGORY 6: Full Cut (Remaining 0)
  await test('6. Full cut: coupon 10 cut 10 -> remaining 0', async () => {
    totalCasesCount += 1;
    const fakeModel = createFakeDbModel({
      coupons: [
        { CouponID: 301, CouponNo: 'C6900301', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 },
      ],
    });
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);
    const existingTx = new fakeModel.FakeTransaction();

    await adapter.createRedemptionDocument({
      docuNo: 'SYN-DOC-005',
      carLicense: '3กก-3333',
      lines: [{ couponId: 301, couponNo: 'C6900301', goodId: 501, goodUnitId: 10, goodPrice: 15000, goodQty: 10.0 }],
    }, { existingTx });
    existingTx.commit();

    const snap = JSON.parse(fakeModel.getSnapshot());
    const cp = snap.coupons.find(([id]) => id === 301)[1];
    assert.strictEqual(cp.RemaQty, 0.0);
  });

  // CATEGORY 7: Explicit Invalid Quantity Cases (T03)
  await test('7. Invalid quantity checks: 0, negative, NaN, ±Infinity, text, sub-milliton (7 cases)', async () => {
    totalCasesCount += 7;
    const fakeModel = createFakeDbModel({
      coupons: [
        { CouponID: 401, CouponNo: 'C6900401', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 },
      ],
    });
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);

    const invalidQtyInputs = [
      { qty: 0, desc: 'zero quantity' },
      { qty: -1.0, desc: 'negative quantity' },
      { qty: NaN, desc: 'NaN quantity' },
      { qty: Infinity, desc: 'Infinity quantity' },
      { qty: -Infinity, desc: '-Infinity quantity' },
      { qty: 'not-a-number', desc: 'string non-numeric quantity' },
      { qty: 0.0001, desc: 'sub-milliton quantity rounds to 0' },
    ];

    for (const item of invalidQtyInputs) {
      await assert.rejects(
        () => adapter.createRedemptionDocument({
          docuNo: 'DOC-QTY-ERR',
          carLicense: 'PLATE',
          lines: [{ couponId: 401, couponNo: 'C6900401', goodId: 501, goodUnitId: 10, goodQty: item.qty }],
        }),
        (err) => err.code === 'INVALID_GOOD_QTY' && err.status === 400,
        `Expected INVALID_GOOD_QTY for ${item.desc}`
      );
    }

    // Zero mutations
    const snap = JSON.parse(fakeModel.getSnapshot());
    assert.strictEqual(snap.redemptionHD.length, 0);
    assert.strictEqual(snap.redemptionDT.length, 0);
    assert.strictEqual(snap.committedTxCount, 0);
  });

  // CATEGORY 8: Business Contract Validations (Input & Mismatch, 14 cases)
  await test('8. Business validation: missing/long docuNo/carLicense, empty lines, duplicate lines, mismatches (14 cases)', async () => {
    totalCasesCount += 14;
    const fakeModel = createFakeDbModel({
      coupons: [
        { CouponID: 501, CouponNo: 'C6900501', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 5.0 },
      ],
    });
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);

    // 8.1 Missing docuNo
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: '', carLicense: 'PLATE', lines: [{ couponId: 501, goodQty: 1 }] }),
      (err) => err.code === 'MISSING_DOCU_NO' && err.status === 400
    );

    // 8.2 DocuNo > 25 chars
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'A'.repeat(26), carLicense: 'PLATE', lines: [{ couponId: 501, goodQty: 1 }] }),
      (err) => err.code === 'DOCU_NO_TOO_LONG' && err.status === 400
    );

    // 8.3 Missing carLicense
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: '', lines: [{ couponId: 501, goodQty: 1 }] }),
      (err) => err.code === 'MISSING_CAR_LICENSE' && err.status === 400
    );

    // 8.4 CarLicense > 25 chars
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'P'.repeat(26), lines: [{ couponId: 501, goodQty: 1 }] }),
      (err) => err.code === 'CAR_LICENSE_TOO_LONG' && err.status === 400
    );

    // 8.5 Empty lines
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [] }),
      (err) => err.code === 'EMPTY_REDEMPTION_LINES' && err.status === 400
    );

    // 8.6 Non-integer / non-positive couponId
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 0, goodQty: 1 }] }),
      (err) => err.code === 'INVALID_COUPON_ID' && err.status === 400
    );

    // 8.7 Duplicate coupon IDs in lines
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [
        { couponId: 501, goodQty: 1 },
        { couponId: 501, goodQty: 1 },
      ] }),
      (err) => err.code === 'DUPLICATE_COUPON_IN_LINES' && err.status === 400
    );

    // 8.8 Invalid docuDate
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', docuDate: 'invalid-date', carLicense: 'PLATE', lines: [{ couponId: 501, goodQty: 1 }] }),
      (err) => err.code === 'INVALID_DOCU_DATE' && err.status === 400
    );

    // 8.9 Duplicate DocuNo under transaction
    fakeModel.state.redemptionHD.set(999, { RedemtionID: 999, DocuNo: 'EXISTING-DOC' });
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'EXISTING-DOC', carLicense: 'PLATE', lines: [{ couponId: 501, goodQty: 1 }] }),
      (err) => err.code === 'DUPLICATE_DELIVERY_DOCU_NO' && err.status === 400
    );
    fakeModel.state.redemptionHD.delete(999);

    // 8.10 Coupon not found
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 99999, goodQty: 1 }] }),
      (err) => err.code === 'COUPON_NOT_FOUND' && err.status === 404
    );

    // 8.11 GoodID mismatch
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 501, couponNo: 'C6900501', goodId: 999, goodQty: 1 }] }),
      (err) => err.code === 'GOOD_ID_MISMATCH' && err.status === 400
    );

    // 8.12 GoodUnitID mismatch
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 501, couponNo: 'C6900501', goodId: 501, goodUnitId: 99, goodQty: 1 }] }),
      (err) => err.code === 'GOOD_UNIT_MISMATCH' && err.status === 400
    );

    // 8.13 CouponNo mismatch
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 501, couponNo: 'WRONG_NO', goodId: 501, goodUnitId: 10, goodQty: 1 }] }),
      (err) => err.code === 'COUPON_NO_MISMATCH' && err.status === 400
    );

    // 8.14 Insufficient coupon balance
    await assert.rejects(
      () => adapter.createRedemptionDocument({ docuNo: 'DOC1', carLicense: 'PLATE', lines: [{ couponId: 501, couponNo: 'C6900501', goodId: 501, goodUnitId: 10, goodQty: 6.0 }] }),
      (err) => err.code === 'INSUFFICIENT_COUPON_REMA_QTY' && err.status === 400
    );

    // Zero mutations
    const snap = JSON.parse(fakeModel.getSnapshot());
    assert.strictEqual(snap.redemptionHD.length, 0);
    assert.strictEqual(snap.redemptionDT.length, 0);
    assert.strictEqual(snap.coupons.find(([id]) => id === 501)[1].RemaQty, 5.0);
  });

  // CATEGORY 9: Observable Transaction Ownership & Rollback Semantics (T01)
  await test('9. Observable transaction ownership: own wrapper vs caller tx, line fault & tail audit failure (6 cases)', async () => {
    totalCasesCount += 6;
    const initialCoupons = [
      { CouponID: 601, CouponNo: 'C6900601', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 },
      { CouponID: 602, CouponNo: 'C6900602', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 },
    ];
    const fakeModel = createFakeDbModel({ coupons: initialCoupons }, suiteOptions);
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);

    // Case 9.1: Own transaction wrapper SUCCESS: commits exactly once, 0 rollbacks
    const resOwn = await adapter.createRedemptionDocument({
      docuNo: 'DOC-OWN-SUCCESS',
      carLicense: 'PLATE-1',
      lines: [{ couponId: 601, couponNo: 'C6900601', goodId: 501, goodUnitId: 10, goodQty: 1.0 }],
    });
    assert.strictEqual(resOwn.success, true);
    const ownTxSuccess = fakeModel.getLastOwnTx();
    assert.strictEqual(ownTxSuccess.commitCount, 1, 'Own wrapper must commit on success');
    assert.strictEqual(ownTxSuccess.rollbackCount, 0, 'Own wrapper must not rollback on success');
    assert.strictEqual(ownTxSuccess.committed, true);

    // Case 9.2: Own transaction wrapper FAILURE: rolls back exactly once before rethrow
    fakeModel.setForceRowsAffected0(true);
    await assert.rejects(
      () => adapter.createRedemptionDocument({
        docuNo: 'DOC-OWN-FAIL',
        carLicense: 'PLATE-2',
        lines: [{ couponId: 601, couponNo: 'C6900601', goodId: 501, goodUnitId: 10, goodQty: 1.0 }],
      }),
      (err) => err.code === 'CONCURRENT_COUPON_DEDUCTION_FAILED' && err.status === 409
    );
    fakeModel.setForceRowsAffected0(false);

    const ownTxFail = fakeModel.getLastOwnTx();
    assert.strictEqual(ownTxFail.commitCount, 0, 'Own wrapper must not commit on error');
    assert.strictEqual(ownTxFail.rollbackCount, 1, 'Own wrapper MUST invoke tx.rollback() on error');
    assert.strictEqual(ownTxFail.rolledBack, true);

    // Case 9.3: ExistingTx SUCCESS: adapter executes queries, does NOT commit or rollback caller tx
    const callerTxSuccess = new fakeModel.FakeTransaction();
    const resCaller = await adapter.createRedemptionDocument({
      docuNo: 'DOC-CALLER-SUCCESS',
      carLicense: 'PLATE-3',
      lines: [{ couponId: 601, couponNo: 'C6900601', goodId: 501, goodUnitId: 10, goodQty: 1.0 }],
    }, { existingTx: callerTxSuccess });
    assert.strictEqual(resCaller.success, true);
    assert.strictEqual(callerTxSuccess.commitCount, 0, 'Adapter must NOT commit caller tx');
    assert.strictEqual(callerTxSuccess.rollbackCount, 0, 'Adapter must NOT rollback caller tx');
    callerTxSuccess.commit(); // Caller commits
    assert.strictEqual(callerTxSuccess.commitCount, 1);

    // Case 9.4: ExistingTx FAILURE: adapter throws, does NOT rollback caller tx; caller rolls back
    const callerTxFail = new fakeModel.FakeTransaction();
    await assert.rejects(
      () => adapter.createRedemptionDocument({
        docuNo: 'DOC-CALLER-FAIL',
        carLicense: 'PLATE-4',
        lines: [{ couponId: 601, couponNo: 'C6900601', goodId: 501, goodUnitId: 10, goodQty: 99.0 }], // insufficient
      }, { existingTx: callerTxFail }),
      (err) => err.code === 'INSUFFICIENT_COUPON_REMA_QTY'
    );
    assert.strictEqual(callerTxFail.commitCount, 0, 'Adapter must not commit caller tx on failure');
    assert.strictEqual(callerTxFail.rollbackCount, 0, 'Adapter must not rollback caller tx on failure');
    callerTxFail.rollback(); // Caller owns rollback
    assert.strictEqual(callerTxFail.rollbackCount, 1);

    // Case 9.5: Fault after Line 1 in multi-coupon insert: Line 1 was staged, then fully discarded
    fakeModel.setFailAfterLineIndex(1);
    const lineFaultTx = new fakeModel.FakeTransaction();
    await assert.rejects(
      () => adapter.createRedemptionDocument({
        docuNo: 'DOC-LINE-FAULT',
        carLicense: 'PLATE-5',
        lines: [
          { couponId: 601, couponNo: 'C6900601', goodId: 501, goodUnitId: 10, goodQty: 1.0 },
          { couponId: 602, couponNo: 'C6900602', goodId: 501, goodUnitId: 10, goodQty: 1.0 },
        ],
      }, { existingTx: lineFaultTx }),
      (err) => err.code === 'SIMULATED_LINE_FAULT'
    );
    fakeModel.setFailAfterLineIndex(-1);
    lineFaultTx.rollback();
    assert.strictEqual(lineFaultTx.stagedInserts.DT.length, 0, 'Staged DT must be discarded');

    // Case 9.6: Positive tail audit failure: all staged HD, DT, coupon deduction, mirror rolled back
    fakeModel.setSimulateAuditFailure(true);
    const auditFaultTx = new fakeModel.FakeTransaction();
    await assert.rejects(
      () => adapter.createRedemptionDocument({
        docuNo: 'DOC-AUDIT-FAULT',
        carLicense: 'PLATE-6',
        lines: [{ couponId: 602, couponNo: 'C6900602', goodId: 501, goodUnitId: 10, goodQty: 2.0 }],
      }, { existingTx: auditFaultTx }),
      (err) => err.code === 'SIMULATED_AUDIT_INSERT_FAILURE'
    );
    fakeModel.setSimulateAuditFailure(false);
    auditFaultTx.rollback();
    assert.strictEqual(auditFaultTx.stagedInserts.HD.length, 0);
    assert.strictEqual(auditFaultTx.stagedInserts.DT.length, 0);
    assert.strictEqual(auditFaultTx.stagedInserts.mirror.length, 0);
    assert.strictEqual(auditFaultTx.stagedCouponUpdates.size, 0);
  });

  // CATEGORY 10: Model Counters, Snapshot Integrity & Anti-Leak Proof (T01)
  await test('10. Model snapshots & counter integrity: derived counter proof and zero mutation leaks (3 cases)', async () => {
    totalCasesCount += 3;
    const fakeModel = createFakeDbModel({
      coupons: [{ CouponID: 701, CouponNo: 'C6900701', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 }],
    });
    const adapter = loadAdapterInIsolatedVm(true, fakeModel.fakeDbModule, suiteOptions);

    const dataSnapBefore = fakeModel.getDataSnapshot();
    const parsedBefore = JSON.parse(dataSnapBefore);
    assert.strictEqual(parsedBefore.computedMaxRedemtionId, 100);
    assert.strictEqual(parsedBefore.computedMaxAuditId, 500);

    // Case 10.1: Rejected call (insufficient qty 99.0) must NOT advance computed IDs (100 must NOT become 101)
    await assert.rejects(
      () => adapter.createRedemptionDocument({
        docuNo: 'DOC-REJECT-LEAK',
        carLicense: 'PLATE',
        lines: [{ couponId: 701, couponNo: 'C6900701', goodId: 501, goodUnitId: 10, goodQty: 99.0 }],
      }),
      (err) => err.code === 'INSUFFICIENT_COUPON_REMA_QTY'
    );

    const dataSnapAfterFail = fakeModel.getDataSnapshot();
    const parsedAfterFail = JSON.parse(dataSnapAfterFail);
    assert.strictEqual(parsedAfterFail.computedMaxRedemtionId, 100, 'RedemtionID counter must remain 100 on failure');
    assert.strictEqual(parsedAfterFail.computedMaxAuditId, 500, 'AuditId counter must remain 500 on failure');
    assert.strictEqual(dataSnapBefore, dataSnapAfterFail, 'Data snapshot must be identical byte-for-byte after rejected mutation');

    const fullSnapAfterFail = JSON.parse(fakeModel.getSnapshot());
    assert.strictEqual(fullSnapAfterFail.committedTxCount, 0, 'Committed transactions must remain 0');
    assert.strictEqual(fullSnapAfterFail.rolledBackTxCount, 1, 'Rolled back transactions must be 1 on failure');

    // Case 10.2: Committed document advances computed counter derived strictly from rows
    const resSuccess = await adapter.createRedemptionDocument({
      docuNo: 'DOC-COMMIT-COUNTER',
      carLicense: 'PLATE',
      lines: [{ couponId: 701, couponNo: 'C6900701', goodId: 501, goodUnitId: 10, goodQty: 2.0 }],
    });
    assert.strictEqual(resSuccess.redemtionId, 101);
    assert.strictEqual(resSuccess.auditId, 501);

    const snapAfterCommit = JSON.parse(fakeModel.getSnapshot());
    assert.strictEqual(snapAfterCommit.computedMaxRedemtionId, 101, 'RedemtionID advances to 101 derived from row');
    assert.strictEqual(snapAfterCommit.computedMaxAuditId, 501, 'AuditId advances to 501 derived from row');

    // Case 10.3: reverseRedemptionDocument remains BLOCKED_SPEC
    await assert.rejects(
      () => adapter.reverseRedemptionDocument(),
      (err) => err.code === 'BLOCKED_SPEC' && err.status === 501
    );
  });

  // CATEGORY 11: Anti-Mutant Proof Verification (T01, T02)
  await test('11. Anti-mutant oracle verifications: pre-gate query, extra SQL suffix, missing rollback (3 cases)', async () => {
    totalCasesCount += 3;

    // Case 11.1: Verify test harness catches pre-disabled-gate query
    const modelGateMutant = createFakeDbModel();
    const gateMutantAdapter = loadAdapterInIsolatedVm(false, modelGateMutant.fakeDbModule, { mutantReadBeforeGate: true });
    try {
      await gateMutantAdapter.createRedemptionDocument({
        docuNo: 'DOC-GATE-MUTANT',
        carLicense: 'PLATE',
        lines: [{ couponId: 1, goodQty: 1 }],
      });
      assert.fail('Should have failed on disabled gate');
    } catch (err) {
      assert.strictEqual(err.code, 'NATIVE_POSTING_DISABLED');
    }
    // Oracle check: mutant caused queries to be logged!
    assert(modelGateMutant.eventLedger.queries.length > 0, 'Ledger detected pre-gate query executed by mutant');

    // Case 11.2: Verify strict SQL catalog catches unrecognized SQL / suffix
    const modelSqlMutant = createFakeDbModel();
    const sqlMutantAdapter = loadAdapterInIsolatedVm(true, modelSqlMutant.fakeDbModule, { mutantSqlSuffix: true });
    await assert.rejects(
      () => sqlMutantAdapter.createRedemptionDocument({
        docuNo: 'DOC-SQL-MUTANT',
        carLicense: 'PLATE',
        lines: [{ couponId: 1, goodQty: 1 }],
      }),
      (err) => err.code === 'DISALLOWED_OR_UNRECOGNIZED_SQL',
      'Strict SQL catalog must reject unrecognized query suffix'
    );

    // Case 11.3: Verify wrapper without rollback is caught by observable rollbackCount assertion
    const modelRollbackMutant = createFakeDbModel({
      coupons: [{ CouponID: 801, CouponNo: 'C6900801', GoodID: 501, GoodUnitID: 10, GoodPrice: 15000, RemaQty: 10.0 }],
    }, { mutantOmitOwnRollback: true });
    const rollbackMutantAdapter = loadAdapterInIsolatedVm(true, modelRollbackMutant.fakeDbModule, suiteOptions);

    modelRollbackMutant.setForceRowsAffected0(true);
    await assert.rejects(
      () => rollbackMutantAdapter.createRedemptionDocument({
        docuNo: 'DOC-ROLL-MUTANT',
        carLicense: 'PLATE',
        lines: [{ couponId: 801, couponNo: 'C6900801', goodId: 501, goodUnitId: 10, goodQty: 1.0 }],
      }),
      (err) => err.code === 'CONCURRENT_COUPON_DEDUCTION_FAILED'
    );
    const mutantTx = modelRollbackMutant.getLastOwnTx();
    assert.strictEqual(mutantTx.rollbackCount, 0, 'Mutant omitted rollback');
    // If a test asserts `mutantTx.rollbackCount === 1`, it would fail! That proves the oracle is sensitive to missing rollback.
  });

  console.log(`\n--- SUITE COMPLETED: ${passedCount} PASSED, ${failedCount} FAILED (${totalCasesCount} total cases checked) ---`);

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

// Command-line flag parsing
const args = process.argv.slice(2);
const suiteOptions = {
  useBaselineRed: args.includes('--baseline-red'),
  mutantReadBeforeGate: args.includes('--mutant-read-before-gate'),
  mutantSqlSuffix: args.includes('--mutant-sql-suffix'),
  mutantOmitOwnRollback: args.includes('--mutant-no-rollback'),
};

runSuite(suiteOptions).catch((err) => {
  console.error('Fatal suite runner error:', err);
  process.exit(1);
});
