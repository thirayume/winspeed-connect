'use strict';
// Rehearse the immutable audit correction only on the isolated QA copy.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const sql=require('mssql'),onprem=require('../onprem-target'),runner=require('../run_migrations');
const {QA}=require('../services/native-document-target');
if(process.env.ONPREM_DB_NAME!==QA||process.env.ONPREM_SWITCHABLE_DATABASES!==QA
 ||process.env.DISABLE_BACKGROUND_WORKERS!=='true'||process.env.ONPREM_CONNECTION_PROFILES_DISABLE!=='true')
 throw Error('QA_ISOLATION_REQUIRED');
let pool,tx;
async function run(){
 pool=await new sql.ConnectionPool(onprem.onpremConnectionConfig(process.env,'migration',false)).connect();
 await onprem.assertOnpremPools(pool,pool,{...process.env,DB_OPERATION:'migration'});
 const definition="SELECT OBJECT_DEFINITION(OBJECT_ID('wf.usp_ApplyNativeDocument')) AS Definition";
 const before=(await pool.request().query(definition)).recordset[0].Definition;
 assert(before);
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 await tx.request().batch('SET LOCK_TIMEOUT 10000;');
 const up=fs.readFileSync(path.join(__dirname,'../migrations/268_native_document_business_audit.sql'),'utf8');
 for(let pass=0;pass<2;pass++)for(const batch of runner.splitBatches(up))await tx.request().batch(batch);
 const history=(await tx.request().query('SELECT COUNT(*) AS N FROM wf.NativeDocumentReceipt')).recordset[0].N;
 const down=fs.readFileSync(path.join(__dirname,'../migrations/down/268_native_document_business_audit.down.sql'),'utf8');
 if(history)await assert.rejects(tx.request().batch(runner.splitBatches(down)[0]),/ND_HISTORY_PREVENTS_DOWN/);
 else for(const batch of runner.splitBatches(down))await tx.request().batch(batch);
 await tx.rollback();tx=null;
 assert.equal((await pool.request().query(definition)).recordset[0].Definition,before);
 console.log('NATIVE_V3_AUDIT_268_UP_TWICE_DOWN_HISTORY_REFUSAL_AND_ROLLBACK=PASS');
}
run().catch(e=>{console.error('NATIVE_V3_AUDIT_268_REHEARSAL_FAILED '+(e.code||'ERROR'));process.exitCode=1;})
 .finally(async()=>{if(tx)try{await tx.rollback();}catch{}if(pool)await pool.close();});
