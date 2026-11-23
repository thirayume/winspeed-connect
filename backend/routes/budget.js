const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const budget = require('../services/promotion-budget');
const {hasPermission,hasRole}=require('../services/role-capabilities');

router.use(requireAuth);

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
    if(!hasPermission(req.user,'budget.plan.create')&&!hasPermission(req.user,'budget.plan.review')&&!hasPermission(req.user,'budget.plan.approve')&&!hasRole(req.user,'ACCOUNTING'))return res.status(403).json({message:'ไม่มีสิทธิ์ดูแผนงบประมาณ'});
    const ids=require('../services/business-identity').businessIds(req.user);
    const all=hasPermission(req.user,'budget.plan.review')||hasPermission(req.user,'budget.plan.approve')||hasRole(req.user,'ACCOUNTING');
    const start = (await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
    const result = await wfQuery(`
      SELECT p.*,
             prep.DisplayName AS PreparedByName,
             rev.DisplayName AS ReviewedByName,
             appr.DisplayName AS ApprovedByName
      FROM wf.BudgetPlan p
      LEFT JOIN wf.AppUser prep ON prep.Id = p.PreparedBy
      LEFT JOIN wf.AppUser rev ON rev.Id = p.ReviewedBy
      LEFT JOIN wf.AppUser appr ON appr.Id = p.ApprovedBy
      WHERE CASE WHEN p.PeriodYear BETWEEN 2400 AND 3000 THEN p.PeriodYear-543 ELSE p.PeriodYear END >= @startYear
        AND (@all=1 OR p.PreparedBy=@uid OR p.AssignedReviewerId=@uid OR p.AssignedApproverId=@uid)
      ORDER BY p.PeriodYear DESC, p.Channel
    `, { startYear: { type: sql.Int, value: Number(start.slice(0, 4)) },all:{type:sql.Bit,value:all},uid:{type:sql.Int,value:ids.effective} });
    res.json({ data: camelizeRows((result.recordset || []).filter(p=>budget.canRead(req.user,p))) });
  } catch (error) {
    console.error('[budget]', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/approvers',async(req,res)=>{
 try{
  if(!['budget.plan.create','budget.plan.review','budget.plan.approve'].some(k=>hasPermission(req.user,k)))return res.status(403).json({message:'ไม่มีสิทธิ์'});
  const result=await wfQuery(`SELECT Id,DisplayName,wf.fn_UserHasPermission(Id,'budget.plan.review') CanReview,wf.fn_UserHasPermission(Id,'budget.plan.approve') CanApprove FROM wf.AppUser WHERE IsActive=1 AND (wf.fn_UserHasPermission(Id,'budget.plan.review')=1 OR wf.fn_UserHasPermission(Id,'budget.plan.approve')=1) ORDER BY DisplayName,Id`);
  res.json({data:result.recordset||[]});
 }catch(e){res.status(e.status||500).json({message:e.message});}
});
router.get('/plans/:id',async(req,res)=>{
 try{
  const p=await budget.load(wfQuery,Number(req.params.id));
  if(!budget.canRead(req.user,p))return res.status(403).json({message:'ไม่มีสิทธิ์ในแผนนี้'});
  const start=(await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
  if(budget.year(p.PeriodYear)<Number(start.slice(0,4)))return res.status(404).json({message:'แผนอยู่ก่อนวันเริ่มข้อมูล'});
  res.json(p);
 }catch(e){res.status(e.status||500).json({message:e.message,code:e.code});}
});
router.get('/plans/:id/report',async(req,res)=>{
 try{
  const p=await budget.load(wfQuery,Number(req.params.id));if(!budget.canRead(req.user,p))return res.status(403).json({message:'ไม่มีสิทธิ์'});
  const start=(await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
  if(budget.year(p.PeriodYear)<Number(start.slice(0,4)))return res.status(404).json({message:'แผนอยู่ก่อนวันเริ่มข้อมูล'});
  const result=await require('../services/promotion-budget-report').run({planId:p.PlanId,year:p.PeriodYear});
  const reports=require('./reports'),key='budget-plan-approval';
  const config=await require('../services/report-catalog').createReportCatalog(require('../db'),[key]).get();
  const template=await reports.resolveReportTemplate(key);
  res.json({data:{type:key,title:`คำขออนุมัติงบส่งเสริมการขาย ${p.Title}`,columns:require('../services/promotion-budget-report').columns,...result,isoStamp:config.isoStamps?.[key]||null},template});
 }catch(e){res.status(e.status||500).json({message:e.message});}
});
for(const [method,path,action]of[['post','/plans','save'],['put','/plans/:id','save'],...['submit','review','approve','reject','cancel'].map(a=>['post',`/plans/:id/${a}`,a])]){
 router[method](path,async(req,res)=>{
  try{
   const result=await budget.write(require('../db'),req.user,req.body||{},req.params.id?Number(req.params.id):null,action,req.body?.reason,req.ip);
   res.status(method==='post'&&action==='save'?201:200).json(result);
  }catch(e){if((e.status||500)>=500)console.error('[promotion-budget]',e.code||e.name);res.status(e.status||500).json({message:e.message,code:e.code});}
 });
}
module.exports = router;
