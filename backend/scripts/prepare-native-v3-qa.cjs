'use strict';
// Isolated QA bootstrap. Does not run on a public deployment database.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcrypt');
const {QA}=require('../services/native-document-target');
if(process.env.QA_NATIVE_V3_PREPARE!=='true'||process.env.ONPREM_DB_NAME!==QA||process.env.ONPREM_SWITCHABLE_DATABASES!==QA
 ||process.env.DISABLE_BACKGROUND_WORKERS!=='true'||process.env.ONPREM_CONNECTION_PROFILES_DISABLE!=='true'
 ||Object.entries(process.env).some(([k,v])=>k.startsWith('REBATE_')&&v==='true'))throw Error('QA_BOOTSTRAP_ISOLATION_REQUIRED');
const db=require('../db'),{verifyOperationalMetadata,EXPECTED}=require('../services/initial-invoice-metadata');
const {queryFor}=require('../services/native-document-service');
const stateFile=path.join('/review-state','bootstrap.json');
async function secondProduct(saved){
 if(saved.secondGoodId&&saved.secondNetPrice)return saved;
 const second=(await db.wfQuery(`SELECT TOP 1 g.GoodID,p.GoodPriceNet
  FROM dbo.EMGood g JOIN dbo.EMSetPriceDT p ON p.ListID=g.GoodID
  JOIN dbo.EMSetPriceHD ph ON ph.SetPriceID=p.SetPriceID
  WHERE g.GoodID<>@first AND g.GoodWeight=50 AND g.ExpnID IS NOT NULL AND ISNULL(g.GoodGroupID,0)<>1005
   AND p.GoodPriceNet>0 AND p.GoodPriceNet=FLOOR(p.GoodPriceNet) AND ph.CustID IS NULL
   AND ph.BeginDate<=@date AND(ph.EndDate IS NULL OR ph.EndDate>=@date)
   AND NOT EXISTS(SELECT 1 FROM dbo.ICStockDetail s WHERE s.GoodID=g.GoodID AND s.DocuDate>=@date AND s.CostFlag='Y')
   AND NOT EXISTS(SELECT 1 FROM dbo.ICCostDetail s WHERE s.GoodID=g.GoodID AND s.DocuDate>=@date)
  ORDER BY ph.BeginDate DESC,g.GoodID OPTION(RECOMPILE)`,{
  first:{type:db.sql.Int,value:saved.goodId},date:{type:db.sql.Date,value:saved.today}})).recordset[0];
 if(!second)throw Error('QA_SECOND_PRICED_PRODUCT_UNAVAILABLE');
 return {...saved,secondGoodId:second.GoodID,secondNetPrice:Number(second.GoodPriceNet)};
}
async function run(){
 await db.pools().ready;
 const access=(await db.wfQuery(`SELECT DB_NAME() AS DbName,HAS_DBACCESS('dbwins_worldfert9') AS MainAccess,
  HAS_DBACCESS('dbwins_worldfert2') AS CompanyAccess,HAS_DBACCESS('dbwins_worldfert9_uat') AS UatAccess`)).recordset[0];
 if(access.DbName!==QA||[access.MainAccess,access.CompanyAccess,access.UatAccess].some(v=>v!==0))throw Error('QA_ACCESS_NOT_ISOLATED');
 if(fs.existsSync(stateFile)){
  const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(saved.database!==QA)throw Error('QA_BOOTSTRAP_STATE_MISMATCH');
  const enriched=await secondProduct(saved);
  if(enriched!==saved)fs.writeFileSync(stateFile,JSON.stringify(enriched),{mode:0o600});
  console.log('NATIVE_QA_BOOTSTRAP_EXISTING_PRIVATE_STATE');return;
 }
 const today=(await db.wfQuery("SELECT CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120) AS Today")).recordset[0].Today;
 const candidate=(await db.wfQuery(`SELECT TOP 1 h.CustID,d.GoodID,e.EmpID,p.GoodPriceNet
  FROM(SELECT TOP 300 h.SOID,h.EmpID,h.CustID FROM dbo.SOHD h WHERE h.DocuType=103 AND h.BrchID=1 AND LEFT(h.DocuNo,1)='I' ORDER BY h.SOID DESC)h
  JOIN dbo.SODT d ON d.SOID=h.SOID JOIN dbo.EMGood g ON g.GoodID=d.GoodID
  JOIN dbo.EMEmp e ON e.EmpID=h.EmpID AND e.EmpStatus='1' AND e.EmpType='S'
  JOIN dbo.EMGoodUnit u ON u.GoodUnitID=d.GoodUnitID2 AND u.GoodUnitCode=N'ตัน'
  JOIN dbo.EMSetPriceDT p ON p.ListID=d.GoodID JOIN dbo.EMSetPriceHD ph ON ph.SetPriceID=p.SetPriceID
  WHERE g.GoodWeight=50 AND g.ExpnID IS NOT NULL AND p.GoodPriceNet>0 AND p.GoodPriceNet=FLOOR(p.GoodPriceNet)
   AND ph.CustID IS NULL AND ph.BeginDate<=@date AND(ph.EndDate IS NULL OR ph.EndDate>=@date)
   AND EXISTS(SELECT 1 FROM dbo.EMCustContact c WHERE c.CustID=h.CustID AND c.IsDefault='Y' AND NULLIF(LTRIM(RTRIM(c.ContactName)),'') IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM dbo.EMGood gp WHERE gp.GoodID=g.GoodID AND gp.GoodGroupID=1005)
  ORDER BY h.SOID DESC,ph.BeginDate DESC,p.SetPriceID DESC OPTION(RECOMPILE)`,{date:{type:db.sql.Date,value:today}})).recordset[0];
 if(!candidate)throw Error('QA_LIVE_PRICED_FIXTURE_UNAVAILABLE');
 const approver=(await db.wfQuery(`SELECT TOP 1 e.EmpID FROM dbo.EMEmp e JOIN wf.NativeApproverEmployee a ON a.EmpID=e.EmpID AND a.IsEnabled=1
  WHERE e.EmpStatus='1' AND e.EmpID<>@emp ORDER BY e.EmpID`,{emp:{type:db.sql.Int,value:candidate.EmpID}})).recordset[0];
 if(!approver)throw Error('QA_DISTINCT_APPROVER_UNAVAILABLE');
 const password=crypto.randomBytes(30).toString('base64url'),passwordHash=await bcrypt.hash(password,12),username='qa-v3-'+crypto.randomUUID();
 const result=await db.wfTransaction(async tx=>{
  const q=queryFor(tx);await verifyOperationalMetadata(q);
  const id=(await q(`INSERT wf.AppUser(Username,PasswordHash,DisplayName,Role,EmpId,IsActive,MustChangePassword)
   OUTPUT inserted.Id VALUES(@username,@hash,'QA native acceptance reviewer','ADMIN',@emp,1,0)`,{
   username:{type:db.sql.NVarChar(50),value:username},hash:{type:db.sql.NVarChar(255),value:passwordHash},emp:{type:db.sql.NVarChar(20),value:String(approver.EmpID)}})).recordset[0].Id;
  const existing=(await q("SELECT COUNT(*) AS N FROM wf.NativeWriterContract")).recordset[0].N;
  if(existing!==0)throw Error('QA_CONTRACT_ALREADY_EXISTS_WITHOUT_STATE');
  await q(`INSERT wf.NativeWriterContract(ServerName,DatabaseName,PolicyVersion,MetadataHash,IsEnabled,ApprovedById,ApprovedActorId,ApprovedAtUtc,Evidence)
   VALUES(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')),DB_NAME(),'NATIVE-DOCUMENTS-v3',@hash,1,@u,@u,GETUTCDATE(),
    'Automated isolated QA acceptance bootstrap after actual SQL rollback rehearsal; not a Production release approval')`,{
   hash:{type:db.sql.VarChar(64),value:EXPECTED},u:{type:db.sql.Int,value:id}});
  await q(`INSERT wf.ChangeEvent(EntityType,EntityId,Action,AfterJson,ReasonCode,ReasonText,UserId,ActorUserId)
   VALUES('NATIVE_WRITER_CONTRACT',DB_NAME(),'QA_PREPARE','{"version":"v3","qaOnly":true}','QA_ACCEPTANCE',
    'Owner-authorized isolated Full Loop setup; no live environment changed',CONVERT(varchar(50),@u),CONVERT(varchar(50),@u))`,{u:{type:db.sql.Int,value:id}});
  return id;
 },{isolationLevel:db.sql.ISOLATION_LEVEL.SERIALIZABLE});
 fs.writeFileSync(stateFile,JSON.stringify(await secondProduct({database:QA,username,password,userId:result,today,custId:candidate.CustID,goodId:candidate.GoodID,
  netPrice:Number(candidate.GoodPriceNet),salesEmpId:candidate.EmpID,approverEmpId:approver.EmpID})),{flag:'wx',mode:0o600});
 console.log('NATIVE_QA_BOOTSTRAP_READY_PRIVATE_CREDENTIALS_NOT_PRINTED');
}
run().catch(e=>{console.error('NATIVE_QA_BOOTSTRAP_FAILED '+e.message);process.exitCode=1;}).finally(()=>db.closeAll());
