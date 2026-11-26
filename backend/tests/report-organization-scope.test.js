'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');h.installDbStub(()=>[]);
const scope=require('../services/report-organization-scope'),reports=require('../routes/reports').__testing;
const own={all:false,userIds:[10],empIds:['1010']},other={all:false,userIds:[20],empIds:['1020']};
test('scope is bound before grouping, TOP and both union branches',()=>{
 const sql='SELECT TOP 10 h.EmpID,SUM(d.Qty) Qty FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID=h.SOID WHERE /*ORG_SCOPE:-:h.EmpID*/ GROUP BY h.EmpID UNION ALL SELECT EmpID,0 FROM dbo.SOHD WHERE /*ORG_SCOPE:-:EmpID*/';
 const r=scope.compile(sql,[own,other]);assert.equal(r.count,2);assert.equal(Object.keys(r.inputs).length,4);assert.match(r.sql,/WHERE \(\(CAST\(h.EmpID AS VARCHAR\(20\)\) IN \(@reportOrg0_0E0\)\)\) AND/);assert.doesNotMatch(r.sql,/ORG_SCOPE/);
 assert.deepEqual(Object.values(r.inputs).map(x=>x.value),['1010','1020','1010','1020']);
});
test('empty and malformed scopes fail closed instead of dropping the filter',()=>{
 for(const scopes of [[],[{all:false,userIds:[],empIds:[]}]])assert.match(scope.compile('SELECT 1 WHERE /*ORG_SCOPE:OwnerId:-*/',scopes).sql,/1=0/);
 for(const marker of ['/*ORG_SCOPE:bad-column:-*/','/*ORG_SCOPE:a..b:-*/','/*ORG_SCOPE:-:-*/'])assert.throws(()=>scope.compile('SELECT 1 WHERE '+marker,[own]),/REPORT_SCOPE_MARKER_INVALID/);
});
test('scoped managers have sales and own-team reports; company ledger stays restricted',()=>{
 const req={user:{sub:10,role:'MANAGER'},scopeSeesAll:false,reportScopes:[own]};
 for(const key of ['so-status','sales-order-detail','so-backlog','sales-performance','daily-invoice','net-sales-detail','customer-dispatch','budget-annual-estimate','budget-plan-approval'])assert.equal(reports.canRunReport(req,key),true,key);
 for(const key of ['gl-sales-journal','ar-aging-summary','ap-liabilities'])assert.equal(reports.canRunReport(req,key),false,key);
 assert.equal(reports.canRunReport({...req,reportScopes:undefined},'daily-invoice'),false);
});
test('shared product price catalog still requires each role capability',()=>{
 assert.equal(reports.canRunReport({user:{sub:10,role:'SALES',permissions:[]},scopeSeesAll:false},'costlist_sheet'),false);
 assert.equal(reports.canRunReport({user:{sub:10,role:'MANAGER',permissions:['pricing.view']},scopeSeesAll:false},'pricelist_sheet'),true);
});
