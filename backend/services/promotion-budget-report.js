'use strict';
const db=require('../db'),{year}=require('./promotion-budget');
const columns=[{key:'PeriodYear',label:'ปี พ.ศ.',type:'identifier'},{key:'Channel',label:'ช่องทาง',type:'text'},{key:'Category',label:'หมวด',type:'text'},{key:'ItemName',label:'รายการ',type:'text'},{key:'Region',label:'ภาค / หน่วยงาน',type:'text'},{key:'Quantity',label:'จำนวน',type:'quantity',precision:4},{key:'UnitPrice',label:'ราคาต่อหน่วย',type:'money',precision:2},{key:'Amount',label:'ประมาณการ (บาท)',type:'money',precision:2,aggregation:'sum'},{key:'Status',label:'สถานะ',type:'text'},{key:'Note',label:'หมายเหตุ',type:'text'}];
async function run(params={},options={}){
 const query=options.queryFn||db.wfQuery,{businessDate}=await(options.readGlobalDataWindow||require('./global-data-window-store').readGlobalDataWindow)();
 const ce=year(params.year||require('./so-pickup-policy').getBangkokDateString(options.now).slice(0,4)),id=Number(params.planId||0);
 if(!Number.isSafeInteger(id)||id<0)throw Object.assign(Error('เลขแผนไม่ถูกต้อง'),{status:400});
 const inputs={id:{type:db.sql.Int,value:id},year:{type:db.sql.Int,value:ce},startYear:{type:db.sql.Int,value:Number(businessDate.slice(0,4))}};
 // Older plans have header/region budgets but no detailed estimate. Do not
 // silently turn that missing detail into a zero annual estimate.
 const missing=(await query(`SELECT COUNT(*) MissingPlanDetailsCount FROM wf.BudgetPlan p
 WHERE CASE WHEN p.PeriodYear>=2400 THEN p.PeriodYear-543 ELSE p.PeriodYear END>=@startYear
 AND ((@id>0 AND p.PlanId=@id) OR (@id=0 AND CASE WHEN p.PeriodYear>=2400 THEN p.PeriodYear-543 ELSE p.PeriodYear END=@year AND p.Status='APPROVED'))
 AND NOT EXISTS(SELECT 1 FROM wf.PromotionBudgetLine l WHERE l.PlanId=p.PlanId)`,inputs)).recordset?.[0]?.MissingPlanDetailsCount||0;
 const rows=(await query(`SELECT p.PlanId,p.PeriodYear,p.Channel,p.Title,p.Status,p.PreparedAt,p.ReviewedAt,p.ApprovedAt,
 prep.DisplayName PreparedByName,rev.DisplayName ReviewedByName,appr.DisplayName ApprovedByName,
 l.SortOrder,l.Region,l.Category,l.ItemName,l.Quantity,l.UnitPrice,l.Amount,l.Note
 FROM wf.BudgetPlan p JOIN wf.PromotionBudgetLine l ON l.PlanId=p.PlanId
 LEFT JOIN wf.AppUser prep ON prep.Id=p.PreparedBy LEFT JOIN wf.AppUser rev ON rev.Id=p.ReviewedBy LEFT JOIN wf.AppUser appr ON appr.Id=p.ApprovedBy
 WHERE CASE WHEN p.PeriodYear BETWEEN 2400 AND 3000 THEN p.PeriodYear-543 ELSE p.PeriodYear END>=@startYear
 AND ((@id>0 AND p.PlanId=@id) OR (@id=0 AND CASE WHEN p.PeriodYear>=2400 THEN p.PeriodYear-543 ELSE p.PeriodYear END=@year AND p.Status='APPROVED'))
 ORDER BY p.PeriodYear,p.Channel,l.Category,l.SortOrder,l.Region`,{id:{type:db.sql.Int,value:id},year:{type:db.sql.Int,value:ce},startYear:{type:db.sql.Int,value:Number(businessDate.slice(0,4))}})).recordset||[];
 const allocations=(await query(`SELECT a.Region,SUM(a.Amount) Amount FROM wf.PromotionBudgetAllocation a JOIN wf.BudgetPlan p ON p.PlanId=a.PlanId
 WHERE CASE WHEN p.PeriodYear>=2400 THEN p.PeriodYear-543 ELSE p.PeriodYear END>=@startYear
 AND ((@id>0 AND p.PlanId=@id) OR (@id=0 AND CASE WHEN p.PeriodYear>=2400 THEN p.PeriodYear-543 ELSE p.PeriodYear END=@year AND p.Status='APPROVED')) GROUP BY a.Region ORDER BY a.Region`,{id:{type:db.sql.Int,value:id},year:{type:db.sql.Int,value:ce},startYear:{type:db.sql.Int,value:Number(businessDate.slice(0,4))}})).recordset||[];
 const budgetSummary=allocations.map(a=>({region:a.Region,allocatedAmount:Number(a.Amount),estimatedAmount:rows.filter(r=>r.Region===a.Region).reduce((s,r)=>s+Number(r.Amount),0)}));
 const meta={periodFrom:`${ce}-01-01`,periodTo:`${ce}-12-31`,basis:id?'SELECTED_PLAN':'APPROVED_PLANS_ONLY',isEstimate:true,budgetSummary,
  missingPlanDetailsCount:Number(missing),isPartialScope:Number(missing)>0,
  signatures:id&&rows.length?{prepared:rows[0].PreparedByName,preparedAt:rows[0].PreparedAt,reviewed:rows[0].ReviewedByName,reviewedAt:rows[0].ReviewedAt,approved:rows[0].ApprovedByName,approvedAt:rows[0].ApprovedAt}:null};
 if(id)return {rows,meta};
 const regions=[...new Set([...allocations.map(a=>a.Region),...rows.map(r=>r.Region)])].sort(),groups=new Map();
 for(const r of rows){const key=JSON.stringify([r.PeriodYear,r.Channel,r.Category,r.ItemName]);if(!groups.has(key))groups.set(key,{PeriodYear:r.PeriodYear,Channel:r.Channel,Category:r.Category,ItemName:r.ItemName,Amount:0});const g=groups.get(key),column='Region'+regions.indexOf(r.Region);g[column]=Math.round(((g[column]||0)+Number(r.Amount))*100)/100;g.Amount=Math.round((g.Amount+Number(r.Amount))*100)/100;}
 return {rows:[...groups.values()],columns:[...columns.slice(0,4),...regions.map((region,i)=>({key:'Region'+i,label:region,type:'money',precision:2,aggregation:'sum'})),columns.find(c=>c.key==='Amount')],meta};
}
module.exports={columns,run};
