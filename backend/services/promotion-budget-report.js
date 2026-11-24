'use strict';
const db=require('../db'),{year}=require('./promotion-budget'),document=require('./promotion-budget-document');
const columns=[{key:'PeriodYear',label:'ปี พ.ศ.',type:'identifier'},{key:'Channel',label:'ช่องทาง',type:'text'},
 {key:'ProjectTitle',label:'โครงการ',type:'text'},{key:'Category',label:'หมวด',type:'text'},{key:'ItemName',label:'รายการ',type:'text'},
 {key:'Region',label:'ภาค / หน่วยงาน',type:'text'},{key:'Quantity',label:'จำนวน',type:'quantity',precision:4},
 {key:'UnitPrice',label:'ราคาต่อหน่วย',type:'money',precision:2},{key:'Amount',label:'ประมาณการ (บาท)',type:'money',precision:2,aggregation:'sum'},
 {key:'Status',label:'สถานะ',type:'text'},{key:'Note',label:'หมายเหตุ',type:'text'}];
const projectColumns=[{key:'PlanId',label:'เลขแผนรายปี',type:'identifier'},{key:'PeriodYear',label:'ปี พ.ศ.',type:'identifier'},
 {key:'Channel',label:'ช่องทาง',type:'text'},{key:'ProjectTitle',label:'โครงการ',type:'text'},{key:'ProjectCategory',label:'หมวดโครงการ',type:'text'},
 {key:'RefDoc',label:'เอกสารอ้างอิง',type:'text'},{key:'Region',label:'ภาค / หน่วยงาน',type:'text'},
 {key:'BudgetAmount',label:'วงเงินโครงการ',type:'money',precision:2,aggregation:'sum'},
 {key:'EstimateAmount',label:'ประมาณการ',type:'money',precision:2,aggregation:'sum'},
 {key:'ValidFrom',label:'เริ่ม',type:'date'},{key:'ValidTo',label:'สิ้นสุด',type:'date'},
 {key:'Objective',label:'วัตถุประสงค์',type:'text'},{key:'Status',label:'สถานะ',type:'text'}];
async function run(params={},options={}){
 const query=options.queryFn||db.wfQuery,{businessDate}=await(options.readGlobalDataWindow||require('./global-data-window-store').readGlobalDataWindow)();
 const ce=year(params.year||require('./so-pickup-policy').getBangkokDateString(options.now).slice(0,4)),id=Number(params.planId||0);
 if(!Number.isSafeInteger(id)||id<0)throw Object.assign(Error('เลขแผนไม่ถูกต้อง'),{status:400});
 const register=options.register===true,status=String(params.status||'APPROVED');
 if(!['ALL','DRAFT','PENDING','REJECTED','APPROVED','CLOSED'].includes(status))throw Object.assign(Error('สถานะไม่ถูกต้อง'),{status:400});
 const inputs={id:{type:db.sql.Int,value:id},year:{type:db.sql.Int,value:ce},startYear:{type:db.sql.Int,value:Number(businessDate.slice(0,4))},
  channel:{type:db.sql.NVarChar(30),value:String(params.channel||'')},status:{type:db.sql.VarChar(20),value:register?status:'APPROVED'}};
 const where=`p.DeletedAt IS NULL AND CASE WHEN p.PeriodYear>=2400 THEN p.PeriodYear-543 ELSE p.PeriodYear END>=@startYear
 AND ((@id>0 AND p.PlanId=@id) OR (@id=0 AND CASE WHEN p.PeriodYear>=2400 THEN p.PeriodYear-543 ELSE p.PeriodYear END=@year AND (@status='ALL' OR p.Status=@status)))
 AND (@channel=N'' OR p.Channel=@channel)`;
 const missing=(await query(`SELECT COUNT(*) MissingPlanDetailsCount FROM wf.BudgetPlan p WHERE ${where}
 AND NOT EXISTS(SELECT 1 FROM wf.PromotionBudgetLine l WHERE l.PlanId=p.PlanId)`,inputs)).recordset?.[0]?.MissingPlanDetailsCount||0;
 let rows=(await query(`SELECT p.PlanId,p.PeriodYear,p.Channel,p.Title,p.Status,p.PreparedAt,p.ReviewedAt,p.ApprovedAt,
 prep.DisplayName PreparedByName,rev.DisplayName ReviewedByName,appr.DisplayName ApprovedByName,
 l.SortOrder,l.ProjectKey,l.Region,l.Category,l.ItemName,l.Quantity,l.UnitPrice,l.Amount,l.Note
 FROM wf.BudgetPlan p JOIN wf.PromotionBudgetLine l ON l.PlanId=p.PlanId
 LEFT JOIN wf.AppUser prep ON prep.Id=p.PreparedBy LEFT JOIN wf.AppUser rev ON rev.Id=p.ReviewedBy LEFT JOIN wf.AppUser appr ON appr.Id=p.ApprovedBy
 WHERE ${where} ORDER BY p.PeriodYear,p.Channel,l.Category,l.SortOrder,l.Region`,inputs)).recordset||[];
 const headers=(await query(`SELECT p.PlanId,p.PeriodYear,p.Channel,p.Title,p.Status,p.DocumentJson FROM wf.BudgetPlan p WHERE ${where} ORDER BY p.PlanId`,inputs)).recordset||[];
 const projects=headers.flatMap(h=>{
  let source=document.parse(h.DocumentJson).projects;
  if(!h.DocumentJson&&h.PlanId!=null)source=[{key:'LEGACY',title:h.Title||'แผนเดิม',category:'ข้อมูลเดิม',refDoc:'',region:'ALL',budgetAmount:null,validFrom:String(year(h.PeriodYear||ce))+'-01-01',validTo:String(year(h.PeriodYear||ce))+'-12-31',objective:'ข้อมูลเดิมยังไม่มีรายละเอียดโครงการแยก',goodCodePattern:'',returnType:'NONE',netPrice:null,note:'วงเงินรายปีไม่ถือเป็นวงเงินโครงการโดยอัตโนมัติ',internalParticipants:[],externalParticipants:[],legacy:true}];
  return source.map(p=>({...p,planId:h.PlanId,periodYear:year(h.PeriodYear||ce)+543,channel:h.Channel,status:h.Status}));
 });
 const projectMap=new Map(projects.map(p=>[`${p.planId}:${p.key}`,p]));
 rows=rows.map(r=>({...r,PeriodYear:year(r.PeriodYear||ce)+543,ProjectTitle:projectMap.get(`${r.PlanId}:${r.ProjectKey}`)?.title||r.Title||''}));
 const included=p=>(!params.region||p.region===params.region||p.region==='ALL')&&(!params.category||p.category===params.category);
 const scopedProjects=projects.filter(included),keys=new Set(scopedProjects.map(p=>`${p.planId}:${p.key}`));
 rows=rows.filter(r=>(!params.region||r.Region===params.region)&&(!params.category||keys.has(`${r.PlanId}:${r.ProjectKey}`)||!r.ProjectKey&&r.Category===params.category));
 let allocations=(await query(`SELECT a.Region,SUM(a.Amount) Amount FROM wf.PromotionBudgetAllocation a JOIN wf.BudgetPlan p ON p.PlanId=a.PlanId
 WHERE ${where} GROUP BY a.Region ORDER BY a.Region`,inputs)).recordset||[];
 if(params.region)allocations=allocations.filter(a=>a.Region===params.region);
 const budgetSummary=allocations.map(a=>({region:a.Region,allocatedAmount:Number(a.Amount),estimatedAmount:rows.filter(r=>r.Region===a.Region).reduce((s,r)=>s+Number(r.Amount),0)}));
 const legacyProjectCount=projects.filter(p=>p.legacy).length,period=id&&headers[0]?.PeriodYear?year(headers[0].PeriodYear):ce;
 const meta={notes:legacyProjectCount?['ข้อมูลเดิม '+legacyProjectCount+' แผนยังไม่ได้แยกโครงการ เว้นวงเงินโครงการไว้ ไม่ถือเป็นศูนย์']:[],periodFrom:`${period}-01-01`,periodTo:`${period}-12-31`,basis:id?'SELECTED_PLAN':register?'SELECTED_STATUS':'APPROVED_PLANS_ONLY',isEstimate:true,budgetSummary,
  filters:{year:String(period+543),channel:params.channel||'',region:params.region||'',category:params.category||'',status:id?'SELECTED_PLAN':register?status:'APPROVED'},
  missingPlanDetailsCount:Number(missing),isPartialScope:Number(missing)>0,
  projects:id?scopedProjects:[],
  signatures:id&&rows.length?{prepared:rows[0].PreparedByName,preparedAt:rows[0].PreparedAt,reviewed:rows[0].ReviewedByName,reviewedAt:rows[0].ReviewedAt,approved:rows[0].ApprovedByName,approvedAt:rows[0].ApprovedAt}:null};
 if(register)return {columns:projectColumns,rows:scopedProjects.map(p=>({PlanId:p.planId,PeriodYear:p.periodYear,Channel:p.channel,ProjectTitle:p.title,ProjectCategory:p.category,RefDoc:p.refDoc,Region:p.region,BudgetAmount:p.budgetAmount,EstimateAmount:rows.filter(r=>r.PlanId===p.planId&&(p.legacy?!r.ProjectKey:r.ProjectKey===p.key)).reduce((s,r)=>s+Number(r.Amount),0),ValidFrom:p.validFrom,ValidTo:p.validTo,Objective:p.objective,Status:p.status})),meta};
 if(id)return {rows,meta};
 const regions=[...new Set([...allocations.map(a=>a.Region),...rows.map(r=>r.Region)])].sort(),groups=new Map();
 for(const r of rows){const key=JSON.stringify([r.PeriodYear,r.Channel,r.Category,r.ItemName]);if(!groups.has(key))groups.set(key,{PeriodYear:r.PeriodYear,Channel:r.Channel,Category:r.Category,ItemName:r.ItemName,Amount:0});const g=groups.get(key),column='Region'+regions.indexOf(r.Region);g[column]=Math.round(((g[column]||0)+Number(r.Amount))*100)/100;g.Amount=Math.round((g.Amount+Number(r.Amount))*100)/100;}
 return {rows:[...groups.values()],columns:[columns[0],columns[1],columns[3],columns[4],...regions.map((region,i)=>({key:'Region'+i,label:region,type:'money',precision:2,aggregation:'sum'})),columns.find(c=>c.key==='Amount')],meta};
}
module.exports={columns,projectColumns,run};
