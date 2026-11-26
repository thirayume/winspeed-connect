const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const budget = require('../services/promotion-budget');
const access=require('../services/secondary-budget-report-access');
const {hasPermission,hasRole}=access;

router.use(requireAuth);
router.use(async(req,res,next)=>{try{req.user.budgetRecordScopes=await access.businessScopes(req.user);next();}catch(e){res.status(e.status||503).json({message:'ตรวจขอบเขตแผนงบประมาณไม่สำเร็จ'});}});

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

// GET /api/budget/expenditure
router.get('/expenditure', requireRole('ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'), async (req, res) => {
  try {
    if(!access.perspectives(req.user,true).every(p=>require('../services/role-capabilities').hasRole(p.user,'ADMIN','MANAGER','C_LEVEL','ACCOUNTING')))return res.status(403).json({message:'ไม่มีสิทธิ์ดูค่าใช้จ่ายรวม'});
    if(!req.user.budgetRecordScopes.every(s=>s.all===true))return res.status(403).json({message:'ข้อมูลค่าใช้จ่ายรวมจำกัดตามสิทธิ์บัญชี ใช้รายงานแผนในสายงานแทน'});
    const { year, channel } = req.query;
    const start = (await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
    // Annual plans can use BE years; older giveaway budgets can use CE years.
    // Retain the year containing the cutoff, since the annual totals may carry
    // activity from earlier in that year. This filters display, not the view's
    // underlying spent/remaining arithmetic.
    let where = 'WHERE CASE WHEN PeriodYear BETWEEN 2400 AND 3000 THEN PeriodYear-543 ELSE PeriodYear END >= @startYear';
    const inputs = { startYear: { type: sql.Int, value: Number(start.slice(0, 4)) } };

    if (year) {
      where += ' AND CASE WHEN PeriodYear>=2400 THEN PeriodYear-543 ELSE PeriodYear END = @year';
      inputs.year = { type: sql.Int, value: budget.year(year) };
    }
    if (channel) {
      where += ' AND Channel = @channel';
      inputs.channel = { type: sql.NVarChar(30), value: channel };
    }

    const result = await wfQuery(`
      SELECT *,BudgetAmt AS AllocatedAmount,UsedAmt AS SpentAmount,RemainingAmt AS RemainingAmount
      FROM wf.v_BudgetPlanRegion
      ${where}
      ORDER BY PeriodYear DESC, Region, PlanSection
    `, inputs);

    res.json({ data: camelizeRows(result.recordset || []) });
  } catch (error) {
    console.error('[budget]', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/budget/plans
router.get('/plans', async (req, res) => {
  try {
    if(!access.mayUseBudget(req.user))return res.status(403).json({message:'ไม่มีสิทธิ์ดูแผนงบประมาณ'});
    const ids=require('../services/business-identity').businessIds(req.user);
    const all=access.canReadAllBudget(req.user);
    const scopeFilter=require('../services/budget-record-scope').predicate(req.user.budgetRecordScopes);
    const start = (await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
    const result = await wfQuery(`
      SELECT p.*,
             prep.DisplayName AS PreparedByName,
             rev.DisplayName AS ReviewedByName,
             appr.DisplayName AS ApprovedByName
             ,branch.PositionName AS BranchName
      FROM wf.BudgetPlan p
      LEFT JOIN wf.AppUser prep ON prep.Id = p.PreparedBy
      LEFT JOIN wf.AppUser rev ON rev.Id = p.ReviewedBy
      LEFT JOIN wf.AppUser appr ON appr.Id = p.ApprovedBy
      LEFT JOIN wf.OrgPosition branch ON branch.PositionCode=p.BranchPositionCode
      WHERE (@includeDeleted=1 OR p.DeletedAt IS NULL) AND CASE WHEN p.PeriodYear BETWEEN 2400 AND 3000 THEN p.PeriodYear-543 ELSE p.PeriodYear END >= @startYear
        AND (p.BranchPositionCode IS NOT NULL OR @all=1 OR p.PreparedBy=@uid OR p.PreparedActorId=@uid OR p.AssignedReviewerId=@uid OR p.AssignedApproverId=@uid) AND ${scopeFilter.sql}
      ORDER BY p.PeriodYear DESC, p.BranchPositionCode, p.Channel,p.PlanId
    `, { ...scopeFilter.inputs,startYear: { type: sql.Int, value: Number(start.slice(0, 4)) },all:{type:sql.Bit,value:all},uid:{type:sql.Int,value:ids.effective},includeDeleted:{type:sql.Bit,value:req.query.includeDeleted==='true'} });
    res.json({ data: camelizeRows((result.recordset || []).filter(p=>budget.canRead(req.user,p))),context:access.context(req.user,require('../db').getDbName?.()||require('../services/active-database').primaryDatabase()||'') });
  } catch (error) {
    console.error('[budget]', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/branches',async(req,res)=>{
 try{
  if(!access.mayUseBudget(req.user))return res.status(403).json({message:'ไม่มีสิทธิ์ดูสายงานแผนงบประมาณ'});
  const filter=require('../services/budget-record-scope').branchPredicate(req.user.budgetRecordScopes,'p.PositionCode','budgetDirectory');
  const rows=(await wfQuery(`SELECT p.PositionCode,p.PositionName,p.ReportsTo FROM wf.OrgPosition p WHERE p.IsActive=1 AND ${filter.sql} ORDER BY p.PositionName,p.PositionCode`,filter.inputs)).recordset||[];
  const uid=require('../services/business-identity').businessIds(req.user).effective;
  const own=(await wfQuery('SELECT PositionCode FROM wf.AppUser WHERE Id=@id AND IsActive=1',{id:{type:sql.Int,value:uid}})).recordset?.[0]?.PositionCode;
  res.json({data:rows,defaultBranch:rows.some(p=>p.PositionCode===own)?own:null});
 }catch(e){res.status(e.status||500).json({message:e.message,code:e.code});}
});
router.get('/staff',async(req,res)=>{
 try{
  const {actorPerspective}=require('../services/business-identity'),{getVisibleScope,scopeFilter}=require('../services/visible-scope');
  const actor=actorPerspective(req.user);for(const u of [req.user,actor])if(!hasPermission(u,'budget.plan.create'))return res.status(403).json({message:'ไม่มีสิทธิ์ค้นผู้ร่วมงาน'});
  const scopes=await access.businessScopes(req.user),filters=scopes.map((s,i)=>scopeFilter(s,{userCol:'u.Id',empCol:'u.EmpId',prefix:i===0?'bp':'bpa'+i}));
  const filter={sql:filters.map(f=>'('+f.sql+')').join(' AND '),inputs:Object.assign({},...filters.map(f=>f.inputs))};
  const q=String(req.query.q||'').trim();if(q.length>100)return res.status(400).json({message:'คำค้นยาวเกินไป'});
  const r=await wfQuery(`SELECT TOP 50 u.Id,u.DisplayName,u.Role,u.PositionCode FROM wf.AppUser u WHERE u.IsActive=1 AND ${filter.sql} AND (@q=N'' OR u.DisplayName LIKE @search OR u.PositionCode LIKE @search) ORDER BY u.DisplayName,u.Id`,{...filter.inputs,q:{type:sql.NVarChar(100),value:q},search:{type:sql.NVarChar(202),value:'%'+q+'%'}});
  res.json({data:r.recordset||[]});
 }catch(e){res.status(e.status||500).json({message:e.message});}
});
router.get('/customers',async(req,res)=>{
 try{
  for(const p of access.perspectives(req.user,true))if(!require('../services/role-capabilities').hasPermission(p.user,'budget.plan.create'))return res.status(403).json({message:'ไม่มีสิทธิ์ค้นลูกค้าผู้ร่วมงาน'});
  const q=String(req.query.q||'').trim();if(q.length>100)return res.status(400).json({message:'คำค้นยาวเกินไป'});
  const scopes=await access.businessScopes(req.user),filter=await require('../services/secondary-customer-scope').customerPredicate(req.user,{scopes});
  const r=await wfQuery(`SELECT TOP 50 c.CustID,RTRIM(c.CustCode) AS CustCode,c.CustName FROM dbo.EMCust c LEFT JOIN wf.CustomerExt cx ON cx.CustId=c.CustID WHERE ${filter.sql} AND (@q=N'' OR c.CustName LIKE @search OR c.CustCode LIKE @search) ORDER BY c.CustCode,c.CustID`,{...filter.inputs,q:{type:sql.NVarChar(100),value:q},search:{type:sql.NVarChar(202),value:'%'+q+'%'}});
  res.json(r.recordset||[]);
 }catch(e){res.status(e.status||500).json({message:e.message,code:e.code});}
});
router.get('/approvers',async(req,res)=>{
 try{
  if(!['budget.plan.create','budget.plan.review','budget.plan.approve'].some(k=>hasPermission(req.user,k)))return res.status(403).json({message:'ไม่มีสิทธิ์'});
  const branch=String(req.query.branchPositionCode||'');
  if(!branch)return res.json({data:[]});
  if(!require('../services/budget-record-scope').branchVisible(req.user.budgetRecordScopes,branch))return res.status(403).json({message:'สายงานอยู่นอกสิทธิ์'});
  const reviewer=Number(req.query.reviewerId||0);if(!Number.isSafeInteger(reviewer)||reviewer<0)return res.status(400).json({message:'ผู้ตรวจไม่ถูกต้อง'});
  const result=await wfQuery(`SELECT Id,DisplayName,
   CASE WHEN wf.fn_UserHasPermission(Id,'budget.plan.review')=1 AND wf.fn_IsUserAbovePosition(Id,@branch)=1 THEN 1 ELSE 0 END CanReview,
   CASE WHEN wf.fn_UserHasPermission(Id,'budget.plan.approve')=1 AND wf.fn_IsUserAbovePosition(Id,@branch)=1 AND (@reviewer=0 OR wf.fn_IsOrganizationSuperior(Id,@reviewer)=1) THEN 1 ELSE 0 END CanApprove
   FROM wf.AppUser WHERE IsActive=1 AND wf.fn_IsUserAbovePosition(Id,@branch)=1
   AND (wf.fn_UserHasPermission(Id,'budget.plan.review')=1 OR wf.fn_UserHasPermission(Id,'budget.plan.approve')=1) ORDER BY DisplayName,Id`,{branch:{type:sql.VarChar(30),value:branch},reviewer:{type:sql.Int,value:reviewer}});
  res.json({data:result.recordset||[]});
 }catch(e){res.status(e.status||500).json({message:e.message});}
});
router.get('/plans/:id',async(req,res)=>{
 try{
  const p=await budget.load(wfQuery,Number(req.params.id),false,req.query.includeDeleted==='true');
  if(!budget.canRead(req.user,p))return res.status(403).json({message:'ไม่มีสิทธิ์ในแผนนี้'});
  const start=(await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
  if(budget.year(p.PeriodYear)<Number(start.slice(0,4)))return res.status(404).json({message:'แผนอยู่ก่อนวันเริ่มข้อมูล'});
  res.json(p);
 }catch(e){res.status(e.status||500).json({message:e.message,code:e.code});}
});
router.get('/plans/:id/history',async(req,res)=>{
 try{const p=await budget.load(wfQuery,Number(req.params.id),false,true);if(!budget.canRead(req.user,p))return res.status(403).json({message:'ไม่มีสิทธิ์'});
 const start=(await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;if(budget.year(p.PeriodYear)<Number(start.slice(0,4)))return res.status(404).json({message:'แผนอยู่ก่อนวันเริ่มข้อมูล'});
 const r=await wfQuery("SELECT TOP 200 EventId,Action,ReasonText,UserId,ActorUserId,CreatedAt FROM wf.ChangeEvent WHERE EntityType='PROMOTION_BUDGET' AND EntityId=@id ORDER BY CreatedAt DESC,EventId DESC",{id:{type:sql.NVarChar(100),value:String(p.PlanId)}});res.json({data:r.recordset||[]});
 }catch(e){res.status(e.status||500).json({message:e.message});}
});
async function report(req,key,id){
 if(id!==null&&(!Number.isSafeInteger(id)||id<=0))throw Object.assign(Error('เลขแผนไม่ถูกต้อง'),{status:400});
 const reports=require('./reports');
 const config=await require('../services/report-catalog').createReportCatalog(require('../db'),[key]).get();
 if(config.visibility[key]===false)throw Object.assign(Error('รายงานนี้ยังไม่เผยแพร่'),{status:403});
 if(!id){const actor=require('../services/business-identity').actorPerspective(req.user);for(const u of [req.user,actor])if(!access.canReadAllBudget(u))throw Object.assign(Error('ไม่มีสิทธิ์ดูรายงานรวมทุกแผน'),{status:403});}
 const data=await require('../db').wfTransaction(async tx=>{
  const q=budget.query(tx,sql);let p;
  if(id){p=await budget.load(q,id,true);if(!budget.canRead(req.user,p))throw Object.assign(Error('ไม่มีสิทธิ์ในแผนนี้'),{status:403});const start=(await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;if(budget.year(p.PeriodYear)<Number(start.slice(0,4)))throw Object.assign(Error('แผนอยู่ก่อนวันเริ่มข้อมูล'),{status:404});}
  const r=await require('../services/promotion-budget-report').run({...req.query,planId:id||undefined,year:p?.PeriodYear||req.query.year},{queryFn:q,register:key==='budget-project-register',scopes:req.user.budgetRecordScopes});
  return {type:key,title:key==='budget-plan-approval'?'คำขออนุมัติงบส่งเสริมการขาย '+p.Title:key==='budget-project-register'?'ทะเบียนโครงการส่งเสริมการขาย':'ประมาณการค่าใช้จ่ายส่งเสริมการขายรายปี',columns:require('../services/promotion-budget-report').columns,...r,isoStamp:config.isoStamps?.[key]||null};
 },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
 return {data,template:await reports.resolveReportTemplate(key)};
}
async function sendReport(req,res,key,id){try{const result=await report(req,key,id);if(req.path.endsWith('/export')){
 const XLSX=require('xlsx'),wb=require('../services/promotion-budget-workbook').workbook(result.data);
 res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="'+key+'-'+(id||'annual')+'.xlsx"');return res.send(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
 }res.json(result);}catch(e){res.status(e.status||500).json({message:e.message,code:e.code});}}
router.get('/plans/:id/report',(req,res)=>sendReport(req,res,'budget-plan-approval',Number(req.params.id)));
router.get('/plans/:id/export',(req,res)=>sendReport(req,res,'budget-plan-approval',Number(req.params.id)));
router.get('/reports/annual',(req,res)=>sendReport(req,res,'budget-annual-estimate',null));
router.get('/reports/annual/export',(req,res)=>sendReport(req,res,'budget-annual-estimate',null));
router.get('/reports/projects',(req,res)=>sendReport(req,res,'budget-project-register',null));
router.get('/reports/projects/export',(req,res)=>sendReport(req,res,'budget-project-register',null));
for(const [method,path,action]of[['delete','/plans/:id','delete'],['post','/plans','save'],['put','/plans/:id','save'],...['submit','review','approve','reject','cancel','restore'].map(a=>['post',`/plans/:id/${a}`,a])]){
 router[method](path,async(req,res)=>{
  try{
   const result=await budget.write(require('../db'),req.user,req.body||{},req.params.id?Number(req.params.id):null,action,req.body?.reason,req.ip);
   res.status(method==='post'&&action==='save'?201:200).json(result);
  }catch(e){if((e.status||500)>=500)console.error('[promotion-budget]',e.code||e.name);res.status(e.status||500).json({message:e.message,code:e.code});}
 });
}
module.exports = router;
