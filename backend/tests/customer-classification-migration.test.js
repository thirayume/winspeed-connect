'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../migrations/217_customer_classification_atomic.sql'),'utf8');
const down=fs.readFileSync(path.join(__dirname,'../migrations/down/217_customer_classification_atomic.down.sql'),'utf8');
test('classification procedure requires a transaction and updates only explicitly requested native columns',()=>{
 assert.match(sql,/IF @@TRANCOUNT=0/);assert.match(sql,/WITH \(UPDLOCK,HOLDLOCK\)/);
 for(const [flag,column] of [['HasArea','SaleAreaID'],['HasGroup','CustGroupID'],['HasBillEmp','BillEmp'],['HasInactive','Inactive']])
   assert.match(sql,new RegExp('IF @'+flag+'=1 UPDATE dbo\\.EMCust SET '+column+'='));
 for(const match of sql.matchAll(/UPDATE dbo\.EMCust SET([\s\S]*?)WHERE CustID=@CustID/gi))
   assert.doesNotMatch(match[1],/\bCustID\s*=/i);
 assert.match(down,/DECLARE @ConfirmedProvenance bit = 0/);assert.match(down,/IF @ConfirmedProvenance <> 1/);
});
