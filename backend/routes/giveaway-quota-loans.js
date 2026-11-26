'use strict';
const router=require('express').Router();
const db=require('../db');
const {requireCapability}=require('../middleware/auth');
const {rebateQuery,transactionQuery}=require('../services/rebate-sql');
const {readGlobalDataWindow}=require('../services/global-data-window-store');
const {getVisibleScope,inScope}=require('../services/visible-scope');
const {actorPerspective}=require('../services/business-identity');
const loans=require('../services/giveaway-quota-loans');
router.use(requireCapability('giveaway.borrow'));
const messages={QUOTA_LOAN_INSUFFICIENT:'โควต้าของผู้ให้ยืมไม่พอ กรุณาตรวจยอดล่าสุด',
 QUOTA_LOAN_RETURN_ALREADY_SPENT:'โควต้าคงเหลือไม่พอคืน กรุณาคืนเฉพาะยอดที่ยังใช้ได้',
 QUOTA_LOAN_RETURN_EXCEEDS_OUTSTANDING:'จำนวนคืนเกินยอดยืมค้าง หรือรายการนี้คืนครบแล้ว',
 QUOTA_LOAN_STALE:'รายการเปลี่ยนแล้ว กรุณารีเฟรชก่อนทำรายการ',
 QUOTA_LOAN_FORBIDDEN:'ไม่มีสิทธิ์ดำเนินการกับรายการนี้',QUOTA_LOAN_DATABASE_CHANGED:'ฐานข้อมูลเปลี่ยน กรุณาโหลดใหม่',
 QUOTA_LOAN_ITEM_MISMATCH:'ต้องเป็นสินค้ารหัสเดียวกันและปีงบเดียวกัน',QUOTA_LOAN_OWNER_CHANGED:'เจ้าของงบเปลี่ยน ต้องตรวจรายการก่อน'};
function error(res,e){const code=/^QUOTA_LOAN_[A-Z_]+$/.test(e.code||'')?e.code:'QUOTA_LOAN_UNAVAILABLE';
 return res.status(e.status||503).json({code,message:messages[code]||'ไม่สามารถทำรายการยืม/คืนได้ กรุณาตรวจข้อมูลและลองใหม่'});}
async function scopes(user,q){return [await getVisibleScope(user,q),await getVisibleScope(actorPerspective(user),q)];}
const visible=(ss,id)=>ss.every(s=>inScope(s,{userId:Number(id)}));
const qread=rebateQuery(db.wfQuery,db.sql);
router.get('/options',async(req,res)=>{
 try{
  const ids=loans.identity(req.user),ss=await scopes(req.user,qread),window=await readGlobalDataWindow();
  const year=Number(req.query.year)||new Date(Date.now()+7*3600000).getUTCFullYear()+543;
  if(!Number.isInteger(year)||year<Number(window.businessDate.slice(0,4))+543||year>3000)
   return res.status(400).json({code:'QUOTA_LOAN_YEAR_INVALID',message:'ปีงบไม่ถูกต้องหรืออยู่ก่อนวันเริ่มข้อมูล'});
  const selected=Number(req.query.borrowerBudgetId)||null;
  if(selected&&(!Number.isSafeInteger(selected)||selected<=0))return res.status(400).json({code:'QUOTA_LOAN_ID_INVALID'});
  let good=null;
  if(selected){const row=(await qread('SELECT SalesUserId,GoodId,PeriodYear FROM wf.GiveawayBudget WHERE Id=@id',{id:selected})).recordset?.[0];
   if(!row||!visible(ss,row.SalesUserId)||!loans.party(req.user,ids,Number(row.SalesUserId)))return res.status(404).json({code:'QUOTA_LOAN_NOT_FOUND'});
   if(Number(row.PeriodYear)!==year)return res.status(409).json({code:'QUOTA_LOAN_ITEM_MISMATCH'});good=row.GoodId;
  }
  const loanScopes=await require('../services/giveaway-loan-organization').counterpartyScopes(qread,req.user);
  const {scopeFilter}=require('../services/visible-scope');const loanInputs={};
  const loanFilters=loanScopes.map((s,i)=>{const f=scopeFilter(s,{userCol:'v.SalesUserId',prefix:'loanOption'+i});Object.assign(loanInputs,f.inputs);return '('+f.sql+')';});
  const rows=(await qread(`SELECT TOP 500 v.Id,v.Region,v.PeriodYear,v.SalesUserId,v.GoodId,v.GoodCode,v.GoodName,
    v.Brand,v.ItemName,v.RemainingQty,u.DisplayName FROM wf.v_GiveawayBudgetStatus v
    JOIN wf.AppUser u ON u.Id=v.SalesUserId AND u.IsActive=1
    WHERE v.PeriodYear=@year AND v.GoodId IS NOT NULL AND (@good IS NULL OR v.GoodId=@good) AND ${loanFilters.join(' AND ')}
    ORDER BY CASE WHEN v.SalesUserId=@me THEN 0 ELSE 1 END,v.GoodId,v.Id`,{year,good,me:ids.effective,...loanInputs})).recordset||[];
  const options=rows.map(r=>({...r,canBorrowInto:visible(ss,r.SalesUserId)&&loans.party(req.user,ids,Number(r.SalesUserId))}));
  const database=(await qread('SELECT DB_NAME() AS DatabaseName')).recordset?.[0]?.DatabaseName;
  res.json({database,year,items:selected?options:options.filter(r=>r.canBorrowInto),limit:500});
 }catch(e){error(res,e);}
});
router.get('/',async(req,res)=>{
 try{
  const ids=loans.identity(req.user),ss=await scopes(req.user,qread),window=await readGlobalDataWindow();
  const before=req.query.before==null?null:Number(req.query.before);
  if(before!==null&&(!/^\d+$/.test(String(req.query.before))||!Number.isSafeInteger(before)||before<=0||before>2147483647))
   return res.status(400).json({code:'QUOTA_LOAN_ID_INVALID'});
  // Only current parties/team members may see a loan. Open older loans remain repayable as opening balances.
  const {scopeFilter}=require('../services/visible-scope');let params={start:window.utcInstant,before};
  const filters=ss.map((s,i)=>{
   const a=scopeFilter(s,{userCol:'l.BorrowerUserId',empCol:null,prefix:`loanBorrower${i}`});
   const b=scopeFilter(s,{userCol:'l.LenderUserId',empCol:null,prefix:`loanLender${i}`});
   Object.assign(params,a.inputs,b.inputs);return `(${a.sql} OR ${b.sql})`;
  });
  const page=(await qread(`SELECT TOP 101 l.*,a.DisplayName AS LenderName,b.DisplayName AS BorrowerName,
    g.GoodName,g.ItemName,g.Brand FROM wf.GiveawayQuotaLoan l
    LEFT JOIN wf.AppUser a ON a.Id=l.LenderUserId LEFT JOIN wf.AppUser b ON b.Id=l.BorrowerUserId
    JOIN wf.GiveawayBudget g ON g.Id=l.LenderBudgetId
    WHERE (@before IS NULL OR l.Id<@before) AND (l.CreatedAtUtc>=@start OR l.Status IN('PENDING','APPROVED'))
     AND ${filters.join(' AND ')} ORDER BY l.Id DESC`,params)).recordset||[];
  const rows=page.slice(0,100);
  const items=rows.map(r=>{const opening=new Date(r.CreatedAtUtc)<window.utcInstant;
   return {id:r.Id,status:r.Status,revision:r.Revision,quantity:r.Quantity,returnedQty:r.ReturnedQty,
    outstanding:Number(r.Quantity)-Number(r.ReturnedQty),lenderName:r.LenderName,borrowerName:r.BorrowerName,
    goodName:r.GoodName||r.ItemName,reason:opening?null:r.Reason,isOpening:opening,
    canDecide:r.Status==='PENDING'&&visible(ss,r.LenderUserId)&&loans.party(req.user,ids,Number(r.LenderUserId)),
    canCancel:r.Status==='PENDING'&&visible(ss,r.BorrowerUserId)&&loans.party(req.user,ids,Number(r.BorrowerUserId)),
    canRepay:r.Status==='APPROVED'&&visible(ss,r.BorrowerUserId)&&loans.party(req.user,ids,Number(r.BorrowerUserId))};
  });
  const database=(await qread('SELECT DB_NAME() AS DatabaseName')).recordset?.[0]?.DatabaseName;
  res.json({database,items,limit:100,nextCursor:page.length>100?rows[rows.length-1].Id:null});
 }catch(e){error(res,e);}
});
function mutate(operation){return async(req,res)=>{
 try{const input={...req.body,id:req.params.id};
  const result=await db.wfTransaction(tx=>operation(transactionQuery(tx,db.sql),req.user,input),{isolationLevel:db.sql.ISOLATION_LEVEL.SERIALIZABLE});
  res.json(result);
 }catch(e){error(res,e);}
};}
router.post('/requests',mutate(loans.requestLoan));
router.post('/:id/decision',mutate(loans.decideLoan));
router.post('/:id/repay',mutate(loans.repayLoan));
module.exports=router;
