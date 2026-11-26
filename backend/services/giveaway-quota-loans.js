'use strict';
const {createHash}=require('crypto');
const {hasPermission,userRoles}=require('./role-capabilities');
const {businessIds,actorPerspective}=require('./business-identity');
const {getVisibleScope,inScope}=require('./visible-scope');
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const integer=v=>{const n=Number(v);if(!/^\d+$/.test(String(v))||!Number.isSafeInteger(n)||n<=0||n>2147483647)fail('QUOTA_LOAN_ID_INVALID',400);return n;};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function units(v){
 const s=String(v??'');if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(s))fail('QUOTA_LOAN_QUANTITY_INVALID',400);
 const [a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));
 if(!Number.isSafeInteger(n)||n<=0||n>999999999999)fail('QUOTA_LOAN_QUANTITY_INVALID',400);return n;
}
const decimal=n=>`${Math.floor(n/100)}.${String(n%100).padStart(2,'0')}`;
const uuid=v=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(v)))fail('QUOTA_LOAN_REQUEST_ID_INVALID',400);return v;};
const reason=v=>{if(typeof v!=='string'||!v.trim()||v.trim().length>500)fail('QUOTA_LOAN_REASON_REQUIRED',400);return v.trim();};
const managers=u=>userRoles(u).some(r=>['ADMIN','MANAGER','C_LEVEL'].includes(r));
function identity(user){
 const ids=businessIds(user),actor=actorPerspective(user);
 if(!ids.actor||!ids.effective||!hasPermission(user,'giveaway.borrow')||!hasPermission(actor,'giveaway.borrow'))fail('QUOTA_LOAN_FORBIDDEN',403);
 return {...ids,primary:integer(user.sub??user.id),actorPrimary:integer(user.actorSub??user.actorId??user.sub??user.id),actorUser:actor};
}
async function database(q,expected){
 const actual=(await q('SELECT DB_NAME() AS DatabaseName')).recordset?.[0]?.DatabaseName;
 if(typeof expected!=='string'||!expected||expected!==actual)fail('QUOTA_LOAN_DATABASE_CHANGED');return actual;
}
async function lockPrincipals(q,user,ids){
 const rows=(await q(`SELECT u.Id,u.IsActive,u.MustChangePassword,
  wf.fn_UserHasPermission(u.Id,'giveaway.borrow') AS HasBorrow,
  wf.fn_UserHasRole(u.Id,'ADMIN') AS HasAdmin,wf.fn_UserHasRole(u.Id,'C_LEVEL') AS HasCLevel,wf.fn_UserHasRole(u.Id,'MANAGER') AS HasManager,
  CASE WHEN wf.fn_UserHasRole(u.Id,'MANAGER')=1 OR wf.fn_UserHasRole(u.Id,'C_LEVEL')=1 OR wf.fn_UserHasRole(u.Id,'ADMIN')=1 THEN 1 ELSE 0 END AS CanManage
  FROM wf.AppUser u WITH(UPDLOCK,HOLDLOCK) WHERE u.Id IN(@effective,@actor)`,{effective:ids.effective,actor:ids.actor})).recordset||[];
 for(const [id,perspective] of [[ids.effective,user],[ids.actor,ids.actorUser]]){
  const row=rows.find(r=>Number(r.Id)===id);
  if(!row||!row.IsActive||row.MustChangePassword||!row.HasBorrow||(managers(perspective)&&!row.CanManage))fail('QUOTA_LOAN_FORBIDDEN',403);
  for(const [role,flag] of [['ADMIN','HasAdmin'],['C_LEVEL','HasCLevel'],['MANAGER','HasManager']]){
   if(userRoles(perspective).includes(role)&&!row[flag])fail('QUOTA_LOAN_FORBIDDEN',403);
  }
 }
}
async function visibleOwner(q,user,owner){
 for(const u of [user,actorPerspective(user)]){
  if(!inScope(await getVisibleScope(u,q),{userId:Number(owner)}))fail('QUOTA_LOAN_OUT_OF_SCOPE',403);
 }
}
function party(user,ids,owner){return (ids.effective===owner||managers(user))&&(ids.actor===owner||managers(ids.actorUser));}
async function lockBudgets(q,a,b){
 for(const id of [a,b].sort((x,y)=>x-y))
  if(!(await q('SELECT Id FROM wf.GiveawayBudget WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id',{id})).recordset?.length)fail('QUOTA_LOAN_BUDGET_MISSING');
 const rows=(await q(`SELECT v.*,u.IsActive AS OwnerActive FROM wf.v_GiveawayBudgetStatus v
   LEFT JOIN wf.AppUser u ON u.Id=v.SalesUserId WHERE v.Id IN(@a,@b)`,{a,b})).recordset||[];
 const lender=rows.find(r=>Number(r.Id)===a),borrower=rows.find(r=>Number(r.Id)===b);
 if(!lender||!borrower)fail('QUOTA_LOAN_BUDGET_MISSING');
 if(!lender.SalesUserId||!borrower.SalesUserId||Number(lender.SalesUserId)===Number(borrower.SalesUserId))fail('QUOTA_LOAN_PARTIES_INVALID',400);
 if(Number(lender.PeriodYear)!==Number(borrower.PeriodYear)||!lender.GoodId||String(lender.GoodId)!==String(borrower.GoodId))fail('QUOTA_LOAN_ITEM_MISMATCH',400);
 return {lender,borrower};
}
async function audit(q,ids,id,action,before,after,note){
 await q(`INSERT wf.ChangeEvent(EntityType,EntityId,Action,BeforeJson,AfterJson,ReasonCode,ReasonText,UserId,ActorUserId,CreatedAt)
 VALUES('GIVEAWAY_QUOTA_LOAN',@id,@action,@before,@after,'GIVEAWAY_QUOTA_LOAN',@reason,@user,@actor,GETUTCDATE())`,
 {id:String(id),action,before:before?JSON.stringify(before):null,after:JSON.stringify({...after,
  identity:{businessUserId:ids.effective,businessActorId:ids.actor,primaryUserId:ids.primary,primaryActorId:ids.actorPrimary}}),
  reason:note,user:String(ids.effective),actor:String(ids.actor)});
}
async function transfer(q,from,to,amount){
 const qty=decimal(amount);
 // The same budget rows are locked by withdrawals and budget edits. The total budget is conserved.
 for(const [id,sign] of [[from,-1],[to,1]]){
  const result=await q('UPDATE wf.GiveawayBudget SET BudgetQty=BudgetQty+@sign*CAST(@qty AS decimal(12,2)),UpdatedAt=GETUTCDATE() WHERE Id=@id',{id,sign,qty});
  if(result.rowsAffected?.[0]!==1)fail('QUOTA_LOAN_BUDGET_CHANGED');
 }
}
async function protectLoanBudget(q,id,before,after){
 const changesIdentity=!after||Number(before.SalesUserId)!==Number(after.SalesUserId)||String(before.GoodId||'')!==String(after.GoodId||'');
 if(!changesIdentity)return;
 const schema=(await q("SELECT OBJECT_ID('wf.GiveawayQuotaLoan','U') AS LoanTable")).recordset?.[0];
 if(!schema?.LoanTable)return; // Before migration 261 no individual quota loan exists.
 const linked=(await q('SELECT TOP 1 Id FROM wf.GiveawayQuotaLoan WHERE LenderBudgetId=@id OR BorrowerBudgetId=@id',{id})).recordset?.[0];
 if(linked)throw Object.assign(Error('โควต้านี้มีประวัติยืม/คืนแล้ว จึงลบหรือเปลี่ยนเจ้าของและสินค้าไม่ได้ กรุณาปรับจำนวนงบแทน'),{status:409,code:'QUOTA_LOAN_BUDGET_HAS_HISTORY'});
}
function assertParties(row,lender,borrower){
 if(Number(row.LenderUserId)!==Number(lender.SalesUserId)||Number(row.BorrowerUserId)!==Number(borrower.SalesUserId))fail('QUOTA_LOAN_OWNER_CHANGED');
}
async function requestLoan(q,user,input,options={}){
 const ids=identity(user),requestId=uuid(input.requestId),a=integer(input.lenderBudgetId),b=integer(input.borrowerBudgetId),qty=units(input.quantity),note=reason(input.reason);
 await database(q,input.expectedDatabase);
 await lockPrincipals(q,user,ids);
 const fingerprint=hash([ids.primary,ids.actorPrimary,ids.effective,ids.actor,a,b,decimal(qty),note]);
 const old=(await q('SELECT * FROM wf.GiveawayQuotaLoan WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@requestId',{requestId})).recordset?.[0];
 if(old){if(old.Fingerprint!==fingerprint)fail('QUOTA_LOAN_REQUEST_CONFLICT');return {...old,replayed:true};}
 const {lender,borrower}=await lockBudgets(q,a,b);
 const window=options.window||await require('./global-data-window-store').readGlobalDataWindow();
 if(Number(borrower.PeriodYear)<Number(window.businessDate.slice(0,4))+543)fail('QUOTA_LOAN_BEFORE_DATA_START',400);
 if(!lender.OwnerActive||!borrower.OwnerActive)fail('QUOTA_LOAN_OWNER_INACTIVE');
 await visibleOwner(q,user,borrower.SalesUserId);
 await require('./giveaway-loan-organization').requireCounterparty(q,user,lender.SalesUserId);
 if(!party(user,ids,Number(borrower.SalesUserId)))fail('QUOTA_LOAN_FORBIDDEN',403);
 await require('./giveaway-loan-organization').requireSuperiorOverride(q,user,borrower.SalesUserId);
 const row=(await q(`INSERT wf.GiveawayQuotaLoan(RequestId,Fingerprint,LenderBudgetId,BorrowerBudgetId,LenderUserId,BorrowerUserId,
 Quantity,Reason,RequestedById,RequesterActorId,RequesterPrimaryId,RequesterActorPrimaryId)
 OUTPUT INSERTED.* VALUES(@requestId,@fingerprint,@a,@b,@lender,@borrower,CAST(@qty AS decimal(12,2)),@note,@user,@actor,@primary,@actorPrimary)`,
 {requestId,fingerprint,a,b,lender:Number(lender.SalesUserId),borrower:Number(borrower.SalesUserId),qty:decimal(qty),note,user:ids.effective,actor:ids.actor,primary:ids.primary,actorPrimary:ids.actorPrimary})).recordset?.[0];
 if(!row?.Id)fail('QUOTA_LOAN_RECEIPT_MISSING',500);
 await audit(q,ids,row.Id,'REQUEST',null,{quantity:decimal(qty),lenderBudgetId:a,borrowerBudgetId:b},note);
 return {...row,replayed:false};
}
async function decideLoan(q,user,input){
 const ids=identity(user),id=integer(input.id),revision=integer(input.revision),action=input.action,note=reason(input.reason);
 if(!['approve','reject','cancel'].includes(action))fail('QUOTA_LOAN_ACTION_INVALID',400);
 await database(q,input.expectedDatabase);
 await lockPrincipals(q,user,ids);
 const row=(await q('SELECT * FROM wf.GiveawayQuotaLoan WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id',{id})).recordset?.[0];
 if(!row)fail('QUOTA_LOAN_NOT_FOUND',404);
 const owner=Number(action==='cancel'?row.BorrowerUserId:row.LenderUserId);
 if(!party(user,ids,owner))fail('QUOTA_LOAN_FORBIDDEN',403);
 await visibleOwner(q,user,owner);
 await require('./giveaway-loan-organization').requireSuperiorOverride(q,user,owner,action==='approve'?row.BorrowerUserId:null);
 if(row.Status!=='PENDING'||Number(row.Revision)!==revision)fail('QUOTA_LOAN_STALE');
 if(action==='approve'){
  await require('./giveaway-loan-organization').requireCounterparty(q,user,row.BorrowerUserId);
  const {lender,borrower}=await lockBudgets(q,Number(row.LenderBudgetId),Number(row.BorrowerBudgetId));assertParties(row,lender,borrower);
  if(!lender.OwnerActive||!borrower.OwnerActive)fail('QUOTA_LOAN_OWNER_INACTIVE');
  const setting=(await q("SELECT SettingValue FROM wf.SystemSetting WITH(HOLDLOCK) WHERE SettingKey='GIVEAWAY_BORROW_MAX_PCT'")).recordset?.[0]?.SettingValue;
  const pct=setting==null?100:Number(setting);if(!Number.isFinite(pct)||pct<0||pct>100)fail('QUOTA_LOAN_POLICY_UNAVAILABLE',503);
  const available=Number(lender.RemainingQty);
  if(!Number.isFinite(available)||available<0||units(row.Quantity)>Math.floor(Math.round(available*100)*pct/100))fail('QUOTA_LOAN_INSUFFICIENT');
  await transfer(q,Number(row.LenderBudgetId),Number(row.BorrowerBudgetId),units(row.Quantity));
 }
 const status={approve:'APPROVED',reject:'REJECTED',cancel:'CANCELLED'}[action];
 const result=await q(`UPDATE wf.GiveawayQuotaLoan SET Status=@status,Revision=Revision+1,DecidedById=@user,
 DeciderActorId=@actor,ChangedAtUtc=GETUTCDATE() WHERE Id=@id AND Revision=@revision AND Status='PENDING'`,{id,revision,status,user:ids.effective,actor:ids.actor});
 if(result.rowsAffected?.[0]!==1)fail('QUOTA_LOAN_STALE');
 await audit(q,ids,id,action.toUpperCase(),{status:'PENDING'},{status},note);
 return {id,status,revision:revision+1};
}
async function repayLoan(q,user,input){
 const ids=identity(user),id=integer(input.id),requestId=uuid(input.requestId),qty=units(input.quantity),note=reason(input.reason);
 await database(q,input.expectedDatabase);
 await lockPrincipals(q,user,ids);
 const fingerprint=hash([id,ids.primary,ids.actorPrimary,ids.effective,ids.actor,decimal(qty),note]);
 const old=(await q('SELECT * FROM wf.GiveawayQuotaRepayment WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@requestId',{requestId})).recordset?.[0];
 if(old){if(old.Fingerprint!==fingerprint)fail('QUOTA_LOAN_REQUEST_CONFLICT');return {id,quantity:old.Quantity,replayed:true};}
 const row=(await q('SELECT * FROM wf.GiveawayQuotaLoan WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id',{id})).recordset?.[0];
 if(!row)fail('QUOTA_LOAN_NOT_FOUND',404);
 if(!party(user,ids,Number(row.BorrowerUserId)))fail('QUOTA_LOAN_FORBIDDEN',403);
 await visibleOwner(q,user,row.BorrowerUserId);
 await require('./giveaway-loan-organization').requireSuperiorOverride(q,user,row.BorrowerUserId);
 const returned=Math.round(Number(row.ReturnedQty)*100),issued=units(row.Quantity);
 if(row.Status!=='APPROVED'||qty>issued-returned)fail('QUOTA_LOAN_RETURN_EXCEEDS_OUTSTANDING');
 const {lender,borrower}=await lockBudgets(q,Number(row.LenderBudgetId),Number(row.BorrowerBudgetId));assertParties(row,lender,borrower);
 const available=Number(borrower.RemainingQty);
 if(!Number.isFinite(available)||Math.round(available*100)<qty)fail('QUOTA_LOAN_RETURN_ALREADY_SPENT');
 await transfer(q,Number(row.BorrowerBudgetId),Number(row.LenderBudgetId),qty);
 const status=returned+qty===issued?'RETURNED':'APPROVED';
 const result=await q(`UPDATE wf.GiveawayQuotaLoan SET ReturnedQty=CAST(@returned AS decimal(12,2)),Status=@status,
 Revision=Revision+1,ChangedAtUtc=GETUTCDATE() WHERE Id=@id AND Revision=@revision AND Status='APPROVED'`,
 {id,revision:Number(row.Revision),returned:decimal(returned+qty),status});
 if(result.rowsAffected?.[0]!==1)fail('QUOTA_LOAN_STALE');
 await q(`INSERT wf.GiveawayQuotaRepayment(RequestId,LoanId,Fingerprint,Quantity,Reason,UserId,ActorUserId,PrimaryUserId,ActorPrimaryId)
 VALUES(@requestId,@id,@fingerprint,CAST(@qty AS decimal(12,2)),@reason,@user,@actor,@primary,@actorPrimary)`,
 {requestId,id,fingerprint,qty:decimal(qty),reason:note,user:ids.effective,actor:ids.actor,primary:ids.primary,actorPrimary:ids.actorPrimary});
 await audit(q,ids,id,'RETURN',{returnedQty:decimal(returned)},{returnedQty:decimal(returned+qty),quantity:decimal(qty),status},note);
 return {id,status,quantity:decimal(qty),returnedQty:decimal(returned+qty),replayed:false};
}
module.exports={units,decimal,requestLoan,decideLoan,repayLoan,party,identity,lockPrincipals,protectLoanBudget};
