'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const sql=require('mssql'),onprem=require('../onprem-target'),runner=require('../run_migrations');
require('./native-v3-qa-profile.cjs').assertQaProfile();
let pool,tx;
async function run(){
 pool=await new sql.ConnectionPool(onprem.onpremConnectionConfig(process.env,'migration',false)).connect();
 await onprem.assertOnpremPools(pool,pool,{...process.env,DB_OPERATION:'migration'});
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 await tx.request().batch('SET LOCK_TIMEOUT 10000;');
 const up=['270_coupon_bridge_contract.sql','271_coupon_bridge_native_dispatch.sql']
  .map(f=>fs.readFileSync(path.join(__dirname,'../migrations/'+f),'utf8')).join('\nGO\n');
 for(let pass=0;pass<2;pass++)for(const batch of runner.splitBatches(up))await tx.request().batch(batch);
 assert.equal((await tx.request().query("SELECT COUNT(*) AS N FROM wf.CouponBridgeContract WHERE Enabled=1")).recordset[0].N,0);
 const down=['271_coupon_bridge_native_dispatch.down.sql','270_coupon_bridge_contract.down.sql']
  .map(f=>fs.readFileSync(path.join(__dirname,'../migrations/down/'+f),'utf8')).join('\nGO\n');
 for(const batch of runner.splitBatches(down))await tx.request().batch(batch);
 await tx.rollback();tx=null;
 assert.equal((await pool.request().query("SELECT OBJECT_ID('wf.CouponBridgePermit','U') AS Id")).recordset[0].Id,null);
 console.log('QA_COUPON_BRIDGE_270_271_UP_TWICE_DOWN_AND_OUTER_ROLLBACK=PASS');
}
run().catch(e=>{console.error('QA_COUPON_BRIDGE_SQL_FAILED '+e.message);process.exitCode=1;})
 .finally(async()=>{if(tx)try{await tx.rollback();}catch{}if(pool)await pool.close();});
