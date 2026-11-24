'use strict';
const bad=(message,status=400)=>Object.assign(Error(message),{status,code:status===409?'BUDGET_CONFLICT':'BUDGET_INVALID'});
const positive=n=>Number.isSafeInteger(Number(n))&&Number(n)>0?Number(n):null;
function year(value){let n=Number(value);if(n>=2400)n-=543;if(!Number.isInteger(n)||n<2000||n>2100)throw bad('ปีงบประมาณไม่ถูกต้อง');return n;}
function text(value,max,required=false){const s=String(value||'').trim();if(s.length>max||required&&!s)throw bad('กรอกข้อมูลรายการงบประมาณให้ครบ');return s;}
function validate(payload){
 const periodYear=year(payload.periodYear)+543,channel=String(payload.channel||'ทั่วไป');
 if(!['ทั่วไป','โรงงานน้ำตาล'].includes(channel))throw bad('ช่องทางไม่ถูกต้อง');
 if(!Array.isArray(payload.lines)||payload.lines.length>500)throw bad('รายการได้ไม่เกิน 500 บรรทัด');
 const document=require('./promotion-budget-document').validate(payload.document||{version:1,projects:[]},year(periodYear));
 const projectKeys=new Set(document.projects.map(p=>p.key));
 const lines=payload.lines.map((l,i)=>{
  if(!l||typeof l!=='object')throw bad('รายละเอียดประมาณการไม่ถูกต้อง');
  const amount=Number(l.amount),quantity=l.quantity==null||l.quantity===''?null:Number(l.quantity),unitPrice=l.unitPrice==null||l.unitPrice===''?null:Number(l.unitPrice);
  if(!Number.isFinite(amount)||amount<0||amount>999999999999||Math.abs(amount*100-Math.round(amount*100))>.0001)throw bad('จำนวนเงินต้องเป็นค่าบวกไม่เกินสองทศนิยม');
  if((quantity==null)!==(unitPrice==null)||quantity!=null&&(!Number.isFinite(quantity)||quantity<0||quantity>999999999||Math.abs(quantity*10000-Math.round(quantity*10000))>.0001||!Number.isFinite(unitPrice)||unitPrice<0||unitPrice>999999999||Math.abs(unitPrice*100-Math.round(unitPrice*100))>.0001||Math.abs(Math.round(quantity*unitPrice*100)-Math.round(amount*100))>0))throw bad('จำนวน × ราคาต้องตรงกับจำนวนเงิน และอยู่ในทศนิยมที่กำหนด');
  const projectKey=l.projectKey?text(l.projectKey,50,true):null;
  if(document.projects.length&&(!projectKey||!projectKeys.has(projectKey)))throw bad('ระบุโครงการให้ครบทุกรายการประมาณการ');
  if(!document.projects.length&&projectKey)throw bad('ไม่พบโครงการของประมาณการ');
  return {projectKey,sortOrder:i+1,region:text(l.region,100,true),category:text(l.category,100,true),itemName:text(l.itemName,200,true),amount,quantity,unitPrice,note:text(l.note,500)};
 });
 if(!Array.isArray(payload.allocations)||payload.allocations.length>100)throw bad('ระบุวงเงินรายภาค');
 const allocations=payload.allocations.map(a=>{if(!a||typeof a!=='object')throw bad('วงเงินรายภาคไม่ถูกต้อง');const region=text(a.region,100,true),amount=Number(a.amount);if(!Number.isFinite(amount)||amount<0||amount>999999999999||Math.abs(amount*100-Math.round(amount*100))>.0001)throw bad('วงเงินไม่ถูกต้อง');return {region,amount};});
 if(new Set(allocations.map(a=>a.region)).size!==allocations.length)throw bad('ภาคในวงเงินรายปีซ้ำ');
 if([...lines,...allocations].reduce((s,l)=>s+Math.round(l.amount*100),0)>99999999999900)throw bad('วงเงินรวมเกินขอบเขต');
 return {periodYear,channel,title:text(payload.title,200,true),note:text(payload.note,500),assignedReviewerId:positive(payload.assignedReviewerId),assignedApproverId:positive(payload.assignedApproverId),document,lines,allocations};
}
function actor(user){return require('./business-identity').businessIds(user);}
function query(tx,sql){return async(s,values={})=>{const r=tx.request();for(const [k,v]of Object.entries(values))r.input(k,v.type,v.value);return r.query(s);};}
function params(sql,data){return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,{type:typeof v==='number'?sql.Decimal(18,4):sql.NVarChar(sql.MAX),value:v}]));}
async function load(q,id,lock=false,includeDeleted=false){
 if(!positive(id))throw bad('เลขแผนไม่ถูกต้อง');
 const p=(await q(`SELECT * FROM wf.BudgetPlan ${lock?'WITH(UPDLOCK,HOLDLOCK)':''} WHERE PlanId=@id`,{id:{type:require('../db').sql.Int,value:id}})).recordset?.[0];
 if(!p||p.DeletedAt&&!includeDeleted)throw bad('ไม่พบแผน',404);
 const lines=(await q('SELECT * FROM wf.PromotionBudgetLine WHERE PlanId=@id ORDER BY SortOrder',{id:{type:require('../db').sql.Int,value:id}})).recordset||[];
 const allocations=(await q('SELECT Region,Amount FROM wf.PromotionBudgetAllocation WHERE PlanId=@id ORDER BY Region',{id:{type:require('../db').sql.Int,value:id}})).recordset||[];
 return {...p,document:require('./promotion-budget-document').parse(p.DocumentJson),lines,allocations};
}
function canRead(user,p){const ids=actor(user);
 const allowed=id=>[p.PreparedBy,p.PreparedActorId,p.AssignedReviewerId,p.AssignedApproverId].map(Number).includes(id);
 return (require('./secondary-budget-report-access').canReadAllBudget(user)||allowed(ids.effective))&&
 (!user.isImpersonating||require('./secondary-budget-report-access').canReadAllBudget(require('./business-identity').actorPerspective(user))||allowed(ids.actor));
}
async function write(db,user,input,id,action,reason,ip){
 if(id!=null&&!positive(id))throw bad('เลขแผนไม่ถูกต้อง');
 const ids=actor(user);if(!ids.effective||!ids.actor)throw bad('ยืนยันผู้ทำรายการไม่ได้',401);
 if(ids.actor!==ids.effective){const context=require('./request-context');if(context.currentActorId()!==ids.actor||!await context.hasColumn(db.wfQuery,'wf.ChangeEvent','ActorUserId'))throw bad('ไม่สามารถบันทึกตัวตนผู้ทำแทนได้',503);}
 reason=text(reason,500,true);
 const body=action==='save'?validate(input):null;
 if(input.expectedDatabase!=null&&String(input.expectedDatabase).toLowerCase()!==String(db.getDbName?.()||require('./active-database').primaryDatabase()||'').toLowerCase())throw Object.assign(bad('ฐานข้อมูลเปลี่ยน กรุณาโหลดแผนใหม่',409),{code:'BUDGET_DATABASE_CHANGED'});
 const {businessDate}=await require('./global-data-window-store').readGlobalDataWindow();
 if(body&&year(body.periodYear)<Number(businessDate.slice(0,4)))throw bad('ปีอยู่ก่อนวันเริ่มข้อมูล');
 return db.wfTransaction(async tx=>{
  const q=query(tx,db.sql),before=id?await load(q,id,true,action==='restore'):null;
  if(before&&year(before.PeriodYear)<Number(businessDate.slice(0,4)))throw bad('แผนอยู่ก่อนวันเริ่มข้อมูล',404);
  if(before&&!canRead(user,before))throw bad('ไม่มีสิทธิ์ในแผนนี้',403);
  if(before&&Number(input.expectedVersion)!==Number(before.EditVersion))throw bad('แผนเปลี่ยนแล้ว กรุณาโหลดใหม่',409);
  const {hasPermission}=require('./secondary-budget-report-access'),perspective=require('./business-identity').actorPerspective;
  const requirePermission=key=>{if(!hasPermission(user,key)||user.isImpersonating&&!hasPermission(perspective(user),key))throw bad('ไม่มีสิทธิ์ดำเนินการขั้นนี้',403);};
  if(action==='save'){
   requirePermission('budget.plan.create');
   if(before&&require('./promotion-budget-document').parse(before.DocumentJson).projects.length&&input.document===undefined)throw bad('กรุณาโหลดหน้าจอรุ่นใหม่ก่อนแก้แผนที่มีข้อมูลโครงการ',409);
   if(before&&!['DRAFT','REJECTED'].includes(before.Status))throw bad('แก้ได้เฉพาะร่างหรือแผนที่ส่งคืน',409);
   if(before&&![before.PreparedBy,before.PreparedActorId].map(Number).includes(ids.effective)&&!hasPermission(user,'settings.manage'))throw bad('แก้แผนของผู้จัดทำอื่นไม่ได้',403);
   const found=(await q('SELECT PlanId FROM wf.BudgetPlan WITH(UPDLOCK,HOLDLOCK) WHERE CASE WHEN PeriodYear>=2400 THEN PeriodYear-543 ELSE PeriodYear END=@year AND Channel=@channel AND (@id IS NULL OR PlanId<>@id)',{year:{type:db.sql.Int,value:year(body.periodYear)},channel:{type:db.sql.NVarChar(30),value:body.channel},id:{type:db.sql.Int,value:id}})).recordset;
   if(found?.length)throw bad('มีแผนของปีและช่องทางนี้แล้ว',409);
   if(!id){
    id=(await q(`INSERT INTO wf.BudgetPlan(PeriodYear,Channel,Title,Status,PreparedBy,PreparedActorId,Note) OUTPUT INSERTED.PlanId VALUES(@periodYear,@channel,@title,'DRAFT',@preparedBy,@preparedActorId,@note)`,params(db.sql,{...Object.fromEntries(['periodYear','channel','title','note'].map(k=>[k,body[k]])),preparedBy:ids.effective,preparedActorId:ids.actor}))).recordset[0].PlanId;
   }
   const values=params(db.sql,{id,title:body.title,note:body.note,periodYear:body.periodYear,channel:body.channel,reviewer:body.assignedReviewerId,approver:body.assignedApproverId,document:JSON.stringify(body.document)});
   await q(`UPDATE wf.BudgetPlan SET PeriodYear=@periodYear,Channel=@channel,Title=@title,Note=@note,DocumentJson=@document,AssignedReviewerId=@reviewer,AssignedApproverId=@approver,Status='DRAFT',ReviewedBy=NULL,ReviewedActorId=NULL,ReviewedAt=NULL,ApprovedBy=NULL,ApprovedActorId=NULL,ApprovedAt=NULL,RejectNote=NULL,EditVersion=EditVersion+1,UpdatedAt=GETUTCDATE() WHERE PlanId=@id`,values);
   await q('DELETE FROM wf.PromotionBudgetLine WHERE PlanId=@id',params(db.sql,{id}));
   await q('DELETE FROM wf.PromotionBudgetAllocation WHERE PlanId=@id',params(db.sql,{id}));
   for(const a of body.allocations)await q('INSERT INTO wf.PromotionBudgetAllocation(PlanId,Region,Amount) VALUES(@id,@region,@amount)',params(db.sql,{id,...a}));
   for(const l of body.lines)await q(`INSERT INTO wf.PromotionBudgetLine(PlanId,SortOrder,Region,Category,ItemName,Quantity,UnitPrice,Amount,Note,ProjectKey) VALUES(@id,@sortOrder,@region,@category,@itemName,@quantity,@unitPrice,@amount,@note,@projectKey)`,params(db.sql,{id,...l}));
  }else{
   if(!before)throw bad('ไม่พบแผน',404);
   if(action==='submit'){
    requirePermission('budget.plan.create');
    if(!['DRAFT','REJECTED'].includes(before.Status)||!before.lines.length)throw bad('แผนยังไม่พร้อมยื่น',409);
    require('./promotion-budget-document').assertReady(before);
    if(!before.allocations.length||before.lines.some(l=>!before.allocations.some(a=>a.Region===l.Region)))throw bad('ระบุวงเงินให้ครบทุกภาคที่มีประมาณการ');
    if(![before.PreparedBy,before.PreparedActorId].map(Number).includes(ids.effective))throw bad('ให้ผู้จัดทำเป็นผู้ยื่น',403);
    const preparers=[before.PreparedBy,before.PreparedActorId].map(Number).filter(n=>n>0);
    if(!before.AssignedReviewerId||!before.AssignedApproverId||Number(before.AssignedReviewerId)===Number(before.AssignedApproverId)||preparers.includes(Number(before.AssignedReviewerId))||preparers.includes(Number(before.AssignedApproverId)))throw bad('เลือกผู้จัดทำ ผู้ตรวจ และผู้อนุมัติคนละบัญชี');
    for(const [uid,permission]of[[before.AssignedReviewerId,'budget.plan.review'],[before.AssignedApproverId,'budget.plan.approve']]){
     const ok=(await q(`SELECT Id FROM wf.AppUser WHERE Id=@uid AND IsActive=1 AND wf.fn_UserHasPermission(Id,@permission)=1`,{uid:{type:db.sql.Int,value:uid},permission:{type:db.sql.NVarChar(100),value:permission}})).recordset;
     if(!ok?.length)throw bad('ผู้พิจารณาไม่มีสิทธิ์หรือปิดใช้งานแล้ว');
    }
   }else if(action==='review'||action==='approve'){
    requirePermission(action==='review'?'budget.plan.review':'budget.plan.approve');
    if(before.Status!=='PENDING'||action==='review'&&before.ReviewedAt||action==='approve'&&!before.ReviewedAt)throw bad('สถานะแผนเปลี่ยนแล้ว',409);
    const assigned=action==='review'?before.AssignedReviewerId:before.AssignedApproverId;
    if(ids.effective!==Number(assigned))throw bad('ไม่ใช่ผู้พิจารณาที่กำหนด',403);
    const prohibited=[before.PreparedBy,before.PreparedActorId,...(action==='approve'?[before.ReviewedBy,before.ReviewedActorId]:[])].map(Number);
    if(prohibited.includes(ids.effective)||prohibited.includes(ids.actor))throw bad('ผู้จัดทำ ผู้ตรวจ และผู้อนุมัติต้องแยกตัวตน',403);
   }else if(action==='reject'){
    const step=before.ReviewedAt?'approve':'review';requirePermission('budget.plan.'+step);
    if(before.Status!=='PENDING'||ids.effective!==Number(step==='review'?before.AssignedReviewerId:before.AssignedApproverId))throw bad('ไม่ใช่ผู้พิจารณาในขั้นนี้',403);
   }else if(action==='restore'){
    requirePermission('budget.plan.create');
    if(!before.DeletedAt||![before.PreparedBy,before.PreparedActorId].map(Number).includes(ids.effective)&&!hasPermission(user,'settings.manage'))throw bad('คืนแผนนี้ไม่ได้',409);
   }else if(action==='delete'){
    requirePermission('budget.plan.create');
    if(!['DRAFT','REJECTED'].includes(before.Status)||![before.PreparedBy,before.PreparedActorId].map(Number).includes(ids.effective)&&!hasPermission(user,'settings.manage'))throw bad('ลบได้เฉพาะร่างหรือแผนที่ส่งคืนของผู้จัดทำ',409);
   }else if(action==='cancel'){
    requirePermission('budget.plan.create');if(!['DRAFT','PENDING','REJECTED'].includes(before.Status)||ids.effective!==Number(before.PreparedBy))throw bad('ยกเลิกแผนนี้ไม่ได้',409);
   }else throw bad('ขั้นตอนไม่ถูกต้อง');
   const sets={submit:"Status='PENDING',PreparedAt=GETUTCDATE(),ReviewedBy=NULL,ReviewedActorId=NULL,ReviewedAt=NULL,ApprovedBy=NULL,ApprovedActorId=NULL,ApprovedAt=NULL,RejectNote=NULL",review:'ReviewedBy=@uid,ReviewedActorId=@actor,ReviewedAt=GETUTCDATE()',approve:"Status='APPROVED',ApprovedBy=@uid,ApprovedActorId=@actor,ApprovedAt=GETUTCDATE()",reject:"Status='REJECTED',RejectNote=@reason",cancel:"Status='CLOSED'",delete:"DeletedAt=GETUTCDATE(),DeletedBy=@uid",restore:"DeletedAt=NULL,DeletedBy=NULL"};
   await q(`UPDATE wf.BudgetPlan SET ${sets[action]},EditVersion=EditVersion+1,UpdatedAt=GETUTCDATE() WHERE PlanId=@id`,params(db.sql,{id,uid:ids.effective,actor:ids.actor,reason}));
  }
  const after=await load(q,id,false,action==='delete');
  await require('./policy-contract').logChangeEvent(tx,{entityType:'PROMOTION_BUDGET',entityId:id,action:action.toUpperCase(),beforeJson:before,afterJson:after,reasonCode:'BUDGET_'+action.toUpperCase(),reasonText:reason,userId:ids.effective,ipAddress:ip});
  return after;
 },{isolationLevel:db.sql.ISOLATION_LEVEL.SERIALIZABLE});
}
module.exports={year,validate,load,query,write,canRead,bad};
