'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const sql=require('mssql'),onprem=require('../onprem-target'),runner=require('../run_migrations');
require('./native-v3-qa-profile.cjs').assertQaProfile();let pool,tx;
async function run(){
 pool=await new sql.ConnectionPool(onprem.onpremConnectionConfig(process.env,'migration',false)).connect();
 await onprem.assertOnpremPools(pool,pool,{...process.env,DB_OPERATION:'migration'});
 const before=(await pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('wf.sp_CouponBridgeObserve')) AS Body,OBJECT_ID('wf.CouponBridgeNativeSession') AS Step")).recordset[0];
 assert.equal(before.Step,null,'Run this only before 273 is applied');assert(before.Body);
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await tx.request().batch('SET LOCK_TIMEOUT 10000');
 const up=fs.readFileSync(path.join(__dirname,'../migrations/273_coupon_bridge_native_session.sql'),'utf8');
 for(let n=0;n<2;n++)for(const b of runner.splitBatches(up))await tx.request().batch(b);
 for(const b of runner.splitBatches(fs.readFileSync(path.join(__dirname,'../migrations/down/273_coupon_bridge_native_session.down.sql'),'utf8')))await tx.request().batch(b);
 await tx.rollback();tx=null;
 const after=(await pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('wf.sp_CouponBridgeObserve')) AS Body,OBJECT_ID('wf.CouponBridgeNativeSession') AS Step")).recordset[0];
 assert.deepEqual(after,before);console.log('QA_BRIDGE_273_UP_TWICE_DOWN_OUTER_ROLLBACK_AND_ORIGINAL_MODULE_RESTORED=PASS');
}
run().catch(e=>{console.error('QA_BRIDGE_273_MIGRATION_FAILED '+e.message);process.exitCode=1;})
 .finally(async()=>{if(tx)try{await tx.rollback();}catch{}if(pool)await pool.close();});
