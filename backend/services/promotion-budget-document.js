'use strict';
// SQL Server 2008 has no JSON operators. Validate the document in Node and keep
// its project keys on normalized estimate lines for deterministic reporting.
const invalid=message=>Object.assign(Error(message),{status:400,code:'BUDGET_INVALID'});
const text=(v,n,required=false)=>{if(v!=null&&!['string','number'].includes(typeof v))throw invalid('ชนิดข้อมูลโครงการไม่ถูกต้อง');const s=String(v??'').trim();if(s.length>n||(required&&!s))throw invalid('ข้อมูลโครงการหรือผู้มีส่วนร่วมไม่ครบ / ยาวเกินกำหนด');return s;};
function money(v){const n=Number(v);if(v==null||v===''||!Number.isFinite(n)||n<0||n>999999999999||Math.abs(n*100-Math.round(n*100))>0.0001)throw invalid('วงเงินโครงการต้องเป็นจำนวนเงินไม่ติดลบ ไม่เกินสองทศนิยม');return Math.round(n*100)/100;}
function parse(raw){if(raw==null||raw==='')return {version:1,projects:[]};let d;try{d=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Object.assign(Error('รายละเอียดแผนไม่ถูกต้อง กรุณาตรวจข้อมูลต้นทาง'),{status:409,code:'BUDGET_DOCUMENT_INVALID'});}if(!d||d.version!==1||!Array.isArray(d.projects))throw Object.assign(Error('รูปแบบรายละเอียดแผนไม่รองรับ'),{status:409,code:'BUDGET_DOCUMENT_INVALID'});return d;}
function validate(raw,ce){
 let d;try{d=parse(raw);}catch{throw invalid('รูปแบบรายละเอียดโครงการไม่ถูกต้อง');}if(d.projects.length>100)throw invalid('เพิ่มโครงการได้ไม่เกิน 100 โครงการ');
 const dates=require('./so-pickup-policy');
 const projects=d.projects.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p))throw invalid('ข้อมูลโครงการไม่ถูกต้อง');
  const key=text(p.key,50,true);if(!/^[A-Za-z0-9_-]+$/.test(key))throw invalid('รหัสโครงการไม่ถูกต้อง');
  const validFrom=text(p.validFrom,10,true),validTo=text(p.validTo,10,true);
  if(!dates.isValidDateString(validFrom)||!dates.isValidDateString(validTo)||!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)||!/^\d{4}-\d{2}-\d{2}$/.test(validTo)||validFrom>validTo||!validFrom.startsWith(String(ce)+'-')||!validTo.startsWith(String(ce)+'-'))throw invalid('วันเริ่ม–สิ้นสุดโครงการต้องอยู่ในปีงบประมาณเดียวกัน');
  const returnType=text(p.returnType||'REBATE',20);if(!['REBATE','PRICEDIFF','NONE'].includes(returnType))throw invalid('ประเภทสิทธิประโยชน์ไม่ถูกต้อง');
  const participants=(list,external)=>{if(!Array.isArray(list)||list.length>500)throw invalid('ผู้มีส่วนร่วมได้ไม่เกิน 500 รายต่อประเภท');return list.map(v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw invalid('ข้อมูลผู้มีส่วนร่วมไม่ถูกต้อง');return external?{custCode:text(v.custCode,100),custName:text(v.custName,200,true),note:text(v.note,500)}:{name:text(v.name,200,true),role:text(v.role,100),dept:text(v.dept,100)};});};
  return {key,title:text(p.title,200,true),category:text(p.category,100,true),refDoc:text(p.refDoc,100),region:text(p.region||'ALL',100,true),validFrom,validTo,budgetAmount:money(p.budgetAmount),objective:text(p.objective,2000),goodCodePattern:text(p.goodCodePattern,100),returnType,netPrice:p.netPrice==null||p.netPrice===''?null:money(p.netPrice),note:text(p.note,500),internalParticipants:participants(p.internalParticipants||[],false),externalParticipants:participants(p.externalParticipants||[],true)};
 });
 if(new Set(projects.map(p=>p.key)).size!==projects.length)throw invalid('รหัสโครงการซ้ำ');
 if(Buffer.byteLength(JSON.stringify(projects),'utf8')>500000)throw invalid('รายละเอียดโครงการมีขนาดใหญ่เกินกำหนด');
 return {version:1,projects};
}
function assertReady(plan){
 const d=parse(plan.DocumentJson),lines=plan.lines||[],allocations=plan.allocations||[];
 for(const a of allocations){const estimate=lines.filter(l=>l.Region===a.Region).reduce((s,l)=>s+Math.round(Number(l.Amount)*100),0);if(estimate>Math.round(Number(a.Amount)*100))throw invalid('ประมาณการเกินวงเงินรายภาค: '+a.Region);}
 const cap=allocations.reduce((s,a)=>s+Math.round(Number(a.Amount)*100),0);
 if(d.projects.reduce((s,p)=>s+Math.round(p.budgetAmount*100),0)>cap)throw invalid('วงเงินโครงการรวมเกินวงเงินแผนรายปี');
 for(const a of allocations)if(d.projects.filter(p=>p.region===a.Region).reduce((s,p)=>s+Math.round(p.budgetAmount*100),0)>Math.round(Number(a.Amount)*100))throw invalid('วงเงินโครงการเกินวงเงินรายภาค: '+a.Region);
 for(const p of d.projects){const estimates=lines.filter(l=>l.ProjectKey===p.key);if(!estimates.length)throw invalid('ทุกโครงการต้องมีรายการประมาณการก่อนยื่นตรวจสอบ');if(estimates.some(l=>p.region!=='ALL'&&l.Region!==p.region))throw invalid('ภาคของประมาณการต้องตรงกับโครงการ');if(estimates.reduce((s,l)=>s+Math.round(Number(l.Amount)*100),0)>Math.round(p.budgetAmount*100))throw invalid('ประมาณการเกินวงเงินโครงการ: '+p.title);}
}
module.exports={parse,validate,assertReady};
