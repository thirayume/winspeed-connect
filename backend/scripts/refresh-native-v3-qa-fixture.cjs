'use strict';
// Refresh only private fixture selection after a date boundary. No business write.
const fs=require('fs'),{assertQaProfile,assertQaAccess}=require('./native-v3-qa-profile.cjs');
assertQaProfile();
const db=require('../db'),file='/review-state/bootstrap.json';
async function run(){
 await db.pools().ready;await assertQaAccess(db.wfQuery);
 const saved=JSON.parse(fs.readFileSync(file,'utf8')),profile=assertQaProfile();
 if(saved.database!==profile.database)throw Error('QA_FIXTURE_TARGET_MISMATCH');
 const today=(await db.wfQuery('SELECT CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120) AS Today')).recordset[0].Today;
 const prices=await db.wfTransaction(async tx=>{
  const q=require('../services/rebate-sql').transactionQuery(tx,db.sql),out=[];
  for(const goodId of [saved.goodId,saved.secondGoodId]){
   const valid=(await q(`SELECT g.GoodID FROM dbo.EMGood g WITH(HOLDLOCK)
    WHERE g.GoodID=@g AND g.GoodWeight=50 AND g.ExpnID IS NOT NULL AND ISNULL(g.GoodGroupID,0)<>1005
     AND NOT EXISTS(SELECT 1 FROM dbo.ICStockDetail WHERE GoodID=@g AND DocuDate>=@date AND CostFlag='Y')
     AND NOT EXISTS(SELECT 1 FROM dbo.ICCostDetail WHERE GoodID=@g AND DocuDate>=@date)`,{g:goodId,date:today})).recordset;
   if(valid.length!==1)throw Error('QA_FIXTURE_COST_OR_GOODS_CHANGED');
   const price=await require('../services/rebate-price-authority').resolveRebateBasePrice(q,{goodId,saleDate:today,custId:saved.custId});
   const n=Number(price.basePrice);
   if(!Number.isInteger(n)||n<=0)throw Error('QA_FIXTURE_PRICE_INVALID');out.push(n);
  }
  const valid=(await q(`SELECT COUNT(*) AS N FROM dbo.EMEmp s WITH(HOLDLOCK)
   JOIN dbo.EMEmp a WITH(HOLDLOCK) ON a.EmpID=@a
   JOIN wf.NativeApproverEmployee n WITH(HOLDLOCK) ON n.EmpID=a.EmpID AND n.IsEnabled=1
   WHERE s.EmpID=@s AND s.EmpID<>a.EmpID AND s.EmpStatus='1' AND s.EmpType='S' AND a.EmpStatus='1'
    AND EXISTS(SELECT 1 FROM dbo.EMCustContact WHERE CustID=@c AND IsDefault='Y' AND NULLIF(LTRIM(RTRIM(ContactName)),'') IS NOT NULL)`,
   {s:saved.salesEmpId,a:saved.approverEmpId,c:saved.custId})).recordset[0].N;
  if(valid!==1)throw Error('QA_FIXTURE_PEOPLE_OR_CUSTOMER_CHANGED');
  return out;
 });
 fs.writeFileSync(file,JSON.stringify({...saved,today,netPrice:prices[0],secondNetPrice:prices[1]}),{mode:0o600});
 console.log('QA_FIXTURE_DATE_PRICES_AND_EXISTING_MAPPING_RECHECKED');
}
run().catch(e=>{console.error('QA_FIXTURE_REFRESH_FAILED '+e.message);process.exitCode=1;}).finally(()=>db.closeAll());
