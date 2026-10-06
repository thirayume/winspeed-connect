'use strict';

/**
 * rehearsal-test-helper.cjs
 *
 * Mock connection pool generator for 100% DB-free rehearsal tests.
 * Satisfies mssql ConnectionPool contract (.query, .request, .transaction)
 * and feeds approved target records for local_uat, local_rehearsal, and remote_b.
 */

function createRehearsalMockPool(profileName = 'local_rehearsal', customHandlers = {}) {
  const targetRecords = {
    local_rehearsal: {
      serverName: 'AMYOU-YOGA7\\V2008R2',
      dbName: 'dbwins_worldfert9_rehearsal',
      loginName: 'wf_uat_migrator',
      originalLogin: 'wf_uat_migrator',
      productVersion: '10.50.4042.0',
      isSysadmin: 0,
      isSecurityadmin: 0,
      isServeradmin: 0,
      isDbcreator: 0,
      hasControlServer: 0,
      netTransport: 'Shared memory',
      prodAccess: 0,
      hasProdAccess: 0,
      otherUserDbCount: 0,
    },
    local_uat: {
      serverName: 'AMYOU-YOGA7\\V2008R2',
      dbName: 'dbwins_worldfert9_local_uat',
      loginName: 'wf_uat_migrator',
      originalLogin: 'wf_uat_migrator',
      productVersion: '10.50.4042.0',
      isSysadmin: 0,
      isSecurityadmin: 0,
      isServeradmin: 0,
      isDbcreator: 0,
      hasControlServer: 0,
      netTransport: 'Shared memory',
      prodAccess: 0,
      hasProdAccess: 0,
      otherUserDbCount: 0,
    },
    remote_b: {
      serverName: '21181f44f254',
      dbName: 'dbwins_worldfert9_test_v2',
      loginName: 'wf_test',
      originalLogin: 'wf_test',
      productVersion: '16.0.4135.4',
      isSysadmin: 0,
      isSecurityadmin: 0,
      isServeradmin: 0,
      isDbcreator: 0,
      hasControlServer: 0,
      netTransport: 'TCP',
      prodAccess: 0,
      hasProdAccess: 0,
      otherUserDbCount: 0,
    },
  };

  if (!targetRecords[profileName]) throw new Error('Unknown mock profile');
  const targetRecord = { ...targetRecords[profileName], ...customHandlers.targetRecord };
  const executedQueries = [];
  const events = [];
  let ledgerRows = [...(customHandlers.ledgerRows || [])];
  if (customHandlers.applied) {
    const runner = require('../run_migrations');
    const policy = runner.loadPolicy();
    const plan = runner.buildPlan(runner.discoverMigrations(undefined, policy, profileName), new Map(), undefined, profileName, policy);
    ledgerRows = plan.entries.map(e => ({ FileName:e.file, Checksum:e.effective.original.hash, BatchCount:e.effective.original.batchCount,
      OriginalChecksum:e.effective.original.hash, ExecutedChecksum:e.checksum, OriginalBatchCount:e.effective.original.batchCount,
      ExecutedBatchCount:e.batchCount, Dialect:e.effective.dialect, ExecutedFile:e.effective.executed.fileName, TargetProfile:profileName }));
  }
  const counters = { WfRefSeq:1000, QuoteRefSeq:1000 };
  const makeReq = tx => {
    const params = {};
    const dispatch = async (text, kind) => {
      executedQueries.push(text); events.push({ kind, text, transaction:Boolean(tx), params:{...params} });
      const override = customHandlers[kind] && await customHandlers[kind](text, params, tx);
      if (override !== undefined) return override;
      if (/@@SERVERNAME|SERVERPROPERTY/i.test(text)) return { recordset:[targetRecord] };
      if (/SELECT\s+OBJECT_ID\('wf\.SchemaMigration'/i.test(text)) return { recordset:[{ LedgerId:ledgerRows.length ? 1 : null, CanInspect:1 }] };
      if (/FROM sys.columns WHERE object_id = OBJECT_ID\('wf.SchemaMigration'/i.test(text)) return { recordset:['OriginalChecksum','ExecutedChecksum','OriginalBatchCount','ExecutedBatchCount','Dialect','ExecutedFile','TargetProfile'].map(name=>({name})) };
      if (/FROM wf.SchemaMigration/i.test(text)) return { recordset:ledgerRows };
      if (/INSERT INTO wf.SchemaMigration/i.test(text)) {
        const row={FileName:params.f,Checksum:params.c,BatchCount:params.b,OriginalChecksum:params.origChecksum,ExecutedChecksum:params.execChecksum,OriginalBatchCount:params.origBatchCount,ExecutedBatchCount:params.execBatchCount,Dialect:params.dialect,ExecutedFile:params.execFile,TargetProfile:params.targetProfile};
        if (tx) tx.pending.push(row); else ledgerRows.push(row);
        return { rowsAffected:[1] };
      }
      if (/REHEARSAL_EXPECTED_FAILURE/.test(text)) throw new Error('REHEARSAL_EXPECTED_FAILURE');
      if (/OBJECT_ID\(@objectName/.test(text)) return {recordset:[{ObjectId:null}]};
      if (params.sequenceName) return {recordset:[{Seq:++counters[params.sequenceName]}]};
      if (/AS HighWater/.test(text)) return {recordset:[{HighWater:'900'}]};
      if (/SELECT SequenceName,/.test(text)) return {recordset:Object.entries(counters).map(([SequenceName,v])=>({SequenceName,CurrentValue:String(v)}))};
      if (/sys.sequences/.test(text)) return {recordset:['WfRefSeq','QuoteRefSeq'].map(name=>({name,CurrentValue:'1000'}))};
      if (/SELECT t.name FROM sys.tables/.test(text)) return {recordset:[{name:'SOHD'},{name:'WFRedemtionHD'}]};
      if (text.includes('AS RowXml FROM dbo.')) return {recordset:[{Id:1,Amount:'42.00'}]};
      if (/FROM sys.triggers tr/.test(text)) return {recordset:[{TableName:'SOHD',TriggerName:'tU_SOHD',is_disabled:0,definition:'fixture trigger'}]};
      if (/FROM sys.indexes i/.test(text)) return {recordset:[{TableName:'SOHD',IndexName:'historical-index',ColumnName:'SOID'}]};
      if (/oracle:(\d+)/.test(text)) {
        const id=Number(/oracle:(\d+)/.exec(text)[1]);
        return {recordset:[{ConvertedValStr:require('./rehearsal-sql2008-oracle.cjs').cases()[id].expected}]};
      }
      return {recordset:[],rowsAffected:[1]};
    };
    const req={ input:(k,t,v)=>{params[k]=v===undefined?t:v;return req;},query:t=>dispatch(t,'query'),batch:t=>dispatch(t,'batch') };
    return req;
  };
  return {
    targetRecord,executedQueries,events,
    connect:async()=>{events.push({kind:'connect'});},
    close:async()=>{events.push({kind:'close'});},
    request:()=>makeReq(),query:t=>makeReq().query(t),
    transaction:()=>{const tx={pending:[],begin:async()=>events.push({kind:'begin'}),commit:async()=>{ledgerRows.push(...tx.pending);events.push({kind:'commit'});},rollback:async()=>{tx.pending=[];events.push({kind:'rollback'});},request:()=>makeReq(tx)};return tx;}
  };
}
module.exports = { createRehearsalMockPool };

