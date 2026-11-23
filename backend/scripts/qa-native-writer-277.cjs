'use strict';
// Only the isolated QA copy: execute up twice and history-protecting down in an outer rollback.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const sql=require('mssql'),onprem=require('../onprem-target'),runner=require('../run_migrations');
require('./native-v3-qa-profile.cjs').assertQaProfile();let pool,tx;
(async()=>{
 pool=await new sql.ConnectionPool(onprem.onpremConnectionConfig(process.env,'migration',false)).connect();
 await onprem.assertOnpremPools(pool,pool,{...process.env,DB_OPERATION:'migration'});
 assert.equal((await pool.request().query('SELECT DB_NAME() Db')).recordset[0].Db,'dbwins_worldfert9_uat_v3');
 const before=(await pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('wf.usp_ReadNativeDocumentMetadata')) Body")).recordset;
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await tx.request().batch('SET LOCK_TIMEOUT 10000');
 const up=fs.readFileSync(path.join(__dirname,'../migrations/277_native_writer_metadata_release.sql'),'utf8');
 for(let i=0;i<2;i++)for(const b of runner.splitBatches(up))await tx.request().batch(b);
 const result=await tx.request().query('EXEC wf.usp_ReadNativeDocumentMetadata');assert.equal(result.recordset.length,49);
 assert(result.recordset.every(r=>typeof r.definition==='string'&&r.definition.length));
 let denied=false;try{for(const b of runner.splitBatches(fs.readFileSync(path.join(__dirname,'../migrations/down/277_native_writer_metadata_release.down.sql'),'utf8')))await tx.request().batch(b);}
 catch(e){denied=/NATIVE_RELEASE_HISTORY_PREVENTS_DOWN/.test(e.message);}assert(denied);
 await tx.rollback();tx=null;
 assert.deepEqual((await pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('wf.usp_ReadNativeDocumentMetadata')) Body")).recordset,before);
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 await tx.request().batch("CREATE PROCEDURE wf.usp_Qa277Down AS BEGIN IF DB_NAME()<>'dbwins_worldfert9_uat_v3' RAISERROR('QA_ONLY',16,1);ELSE BEGIN UPDATE wf.NativeWriterContract SET IsEnabled=0;UPDATE wf.CouponBridgeContract SET Enabled=0;END;END");
 await tx.request().batch('EXEC wf.usp_Qa277Down;DROP PROCEDURE wf.usp_Qa277Down');
 for(const b of runner.splitBatches(fs.readFileSync(path.join(__dirname,'../migrations/down/277_native_writer_metadata_release.down.sql'),'utf8')))await tx.request().batch(b);
 assert.equal((await tx.request().query("SELECT OBJECT_ID('wf.usp_ReadNativeDocumentMetadata') Id")).recordset[0].Id,null);
 await tx.rollback();tx=null;assert.deepEqual((await pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('wf.usp_ReadNativeDocumentMetadata')) Body")).recordset,before);
 console.log('QA277_UP_TWICE_READER49_DOWN_REFUSAL_AND_SUCCESS_OUTER_ROLLBACK_PASS');
})().catch(e=>{console.error('QA277_FAILED '+e.message);process.exitCode=1;})
 .finally(async()=>{if(tx)try{await tx.rollback()}catch{}if(pool)await pool.close();});
