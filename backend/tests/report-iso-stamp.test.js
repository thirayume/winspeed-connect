'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReportCatalog}=require('../services/report-catalog');
function fixture(){let state={},fail=false;class Request{constructor(){this.p={};}input(k,t,v){this.p[k]=v;return this;}async query(s){if(s.includes('SELECT SettingValue'))return {recordset:state[this.p.k]?[{SettingValue:state[this.p.k]}]:[]};if(s.includes('MERGE'))state[this.p.k]=this.p.v;if(s.includes('AdminChangeAudit')&&fail)throw Error('AUDIT_FAILED');return {recordset:[]};}}
 const db={sql:{Request,NVarChar:()=>null,Int:null,MAX:-1},getTarget:()=> 'QA',getDbName:()=> 'QA',wfQuery:async()=>({recordset:Object.entries(state).map(([SettingKey,SettingValue])=>({SettingKey,SettingValue}))}),wfTransaction:async fn=>{const old={...state};try{return await fn({});}catch(e){state=old;throw e;}}};
 return {catalog:createReportCatalog(db,['daily-invoice']),get:()=>state,setFail:v=>fail=v};
}
const config={order:['daily-invoice'],visibility:{'daily-invoice':true},isoStamps:{'daily-invoice':{code:'FM-QA-001',revision:'00',effectiveDate:'2026-11-01'}}};
test('ISO control is per report, survives legacy catalog clients, fits the existing setting and clears explicitly',async()=>{
 const f=fixture();await f.catalog.save(config,1);let r=await f.catalog.get();assert.equal(r.isoStamps['daily-invoice'].code,'FM-QA-001');
 await f.catalog.save({order:config.order,visibility:config.visibility},1);assert.equal((await f.catalog.get()).isoStamps['daily-invoice'].code,'FM-QA-001');assert.ok(Object.values(f.get())[0].length<=200);
 await f.catalog.save({...config,isoStamps:{'daily-invoice':null}},1);assert.equal((await f.catalog.get()).isoStamps['daily-invoice'],null);
});
test('invalid stamps and unknown report keys fail before any mutation',()=>{
 const {catalog}=fixture();for(const v of [{code:'X',effectiveDate:'2026-02-30'},{code:'<script>'},{code:'x'.repeat(61)},'bad'])assert.throws(()=>catalog.validate({...config,isoStamps:{'daily-invoice':v}}));
 assert.throws(()=>catalog.validate({...config,isoStamps:{unknown:config.isoStamps['daily-invoice']}}));
});
test('an audit failure rolls the catalog and ISO stamp back together',async()=>{
 const f=fixture();await f.catalog.save(config,1);const before=JSON.stringify(f.get());f.setFail(true);await assert.rejects(f.catalog.save({...config,visibility:{'daily-invoice':false}},1),/AUDIT_FAILED/);assert.equal(JSON.stringify(f.get()),before);
});
