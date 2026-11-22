
'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const sql=require('mssql'),onprem=require('../onprem-target'),runner=require('../run_migrations');
require('./native-v3-qa-profile.cjs').assertQaProfile();let pool,tx;
async function run(){
 pool=await new sql.ConnectionPool(onprem.onpremConnectionConfig(process.env,'migration',false)).connect();
 await onprem.assertOnpremPools(pool,pool,{...process.env,DB_OPERATION:'migration'});
 const query="SELECT OBJECT_DEFINITION(OBJECT_ID('wf.usp_AllocateNativeRedemptionId')) AS Body";
 const before=(await pool.request().query(query)).recordset;
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await tx.request().batch('SET LOCK_TIMEOUT 10000');
 const up=fs.readFileSync(path.join(__dirname,'../migrations/276_native_redemption_id_history.sql'),'utf8');
 for(let n=0;n<2;n++)for(const b of runner.splitBatches(up))await tx.request().batch(b);
 await tx.request().batch("CREATE PROCEDURE wf.usp_QaAllocatorDown AS BEGIN IF DB_NAME()<>'dbwins_worldfert9_uat_v3' RAISERROR('QA_ONLY',16,1);ELSE UPDATE wf.CouponBridgeContract SET Enabled=0 WHERE Version='116-BRIDGE-v1';END");
 await tx.request().batch('EXEC wf.usp_QaAllocatorDown;DROP PROCEDURE wf.usp_QaAllocatorDown');
 for(const b of runner.splitBatches(fs.readFileSync(path.join(__dirname,'../migrations/down/276_native_redemption_id_history.down.sql'),'utf8')))await tx.request().batch(b);
 assert.deepEqual((await tx.request().query(query)).recordset,before);
 await tx.rollback();tx=null;
 assert.deepEqual((await pool.request().query(query)).recordset,before);
 console.log('QA_BRIDGE_276_UP_TWICE_DOWN_OUTER_ROLLBACK_AND_ORIGINAL_MODULE_RESTORED=PASS');
}
run().catch(e=>{console.error('QA_BRIDGE_276_MIGRATION_FAILED '+e.message);process.exitCode=1;})
 .finally(async()=>{if(tx)try{await tx.rollback();}catch{}if(pool)await pool.close();});
