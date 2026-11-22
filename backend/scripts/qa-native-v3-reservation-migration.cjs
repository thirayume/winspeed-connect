'use strict';
// Rehearse up twice and safe down refusal; restore definitions by outer rollback.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const sql=require('mssql'),onprem=require('../onprem-target'),runner=require('../run_migrations');
const {assertQaProfile}=require('./native-v3-qa-profile.cjs');
assertQaProfile();
let pool,tx;
async function run(){
 pool=await new sql.ConnectionPool(onprem.onpremConnectionConfig(process.env,'migration',false)).connect();
 await onprem.assertOnpremPools(pool,pool,{...process.env,DB_OPERATION:'migration'});
 const definition="SELECT OBJECT_DEFINITION(OBJECT_ID('wf.usp_WriteNativeRedemption')) AS Definition";
 const before=(await pool.request().query(definition)).recordset[0].Definition;assert(before);
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 await tx.request().batch('SET LOCK_TIMEOUT 10000;');
 const up=fs.readFileSync(path.join(__dirname,'../migrations/269_native_reservation_before_debit.sql'),'utf8');
 for(let pass=0;pass<2;pass++)for(const batch of runner.splitBatches(up))await tx.request().batch(batch);
 const history=(await tx.request().query('SELECT COUNT(*) AS N FROM wf.NativeDocumentReceipt WHERE DocuType=116')).recordset[0].N;
 const down=fs.readFileSync(path.join(__dirname,'../migrations/down/269_native_reservation_before_debit.down.sql'),'utf8');
 if(history)await assert.rejects(tx.request().batch(runner.splitBatches(down)[0]),/ND_HISTORY_PREVENTS_DOWN/);
 else for(const batch of runner.splitBatches(down))await tx.request().batch(batch);
 await tx.rollback();tx=null;
 assert.equal((await pool.request().query(definition)).recordset[0].Definition,before);
 console.log('NATIVE_V3_RESERVATION_269_UP_TWICE_DOWN_GUARD_AND_ROLLBACK=PASS');
}
run().catch(e=>{console.error('NATIVE_V3_RESERVATION_269_REHEARSAL_FAILED '+e.message);process.exitCode=1;})
 .finally(async()=>{if(tx)try{await tx.rollback();}catch{}if(pool)await pool.close();});
