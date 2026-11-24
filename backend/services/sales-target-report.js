'use strict';
const db=require('../db'),sales=require('./invoice-register-report');
const columns=[{key:'EmpCode',label:'รหัสฝ่ายขาย',type:'identifier'},{key:'SalesName',label:'พนักงานขาย',type:'text'},
 {key:'ActualTon',label:'ยอดขายสุทธิ (ตัน)',type:'quantity',precision:4,aggregation:'sum'},
 {key:'ActualAmt',label:'ยอดขายสุทธิไม่รวม VAT',type:'money',precision:2,aggregation:'sum'},
 {key:'TargetAmt',label:'เป้ายอดขาย WinSpeed (บาท)',type:'money',precision:2},
 {key:'AchievedPct',label:'บรรลุเป้า (%)',type:'percent',precision:2},
 {key:'TargetState',label:'สถานะเป้าหมาย',type:'text'}];
function coverage(periods,from,to){
 const sorted=[...periods].sort((a,b)=>a.BeginDate.localeCompare(b.BeginDate));
 if(!sorted.length)return 'NOT_CONFIGURED';
 if(sorted[0].BeginDate!==from||sorted.at(-1).EndDate!==to)return 'PERIOD_MISMATCH';
 let next=from;for(const p of sorted){if(p.BeginDate!==next)return 'PERIOD_MISMATCH';next=new Date(Date.parse(p.EndDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
 return 'MATCHED';
}
async function run(params={},options={}){
 const query=options.queryFn||db.wfQuery,{businessDate}=await(options.readGlobalDataWindow||require('./global-data-window-store').readGlobalDataWindow)();
 const f=sales.filters(params,options.now),from=f.from<businessDate?businessDate:f.from;
 if(from>f.to)return {columns,rows:[],meta:{filters:{from:f.from,to:f.to,empCode:f.empCode},dateBasis:'SALES_ADJUSTMENT_DOCUMENT_DATE',amountBasis:'EXCLUDING_VAT',targetCoverage:'BEFORE_START',notes:[`ช่วงที่เลือกอยู่ก่อนวันเริ่มข้อมูล ${businessDate}`]}};
 const [actual,periodsResult,targetsResult]=await Promise.all([
  (options.runSales||sales.run)('net-sales-detail',{from:f.from,to:f.to,empCode:f.empCode,exportAll:'true'},options.salesOptions||{}),
  query(`/* NATIVE_SALES_TARGET_PERIODS */ SELECT PeriodID,CONVERT(varchar(10),BeginDate,120) BeginDate,CONVERT(varchar(10),EndDate,120) EndDate
   FROM dbo.EMSalePeriod WHERE BeginDate<=@to AND EndDate>=@from ORDER BY BeginDate,PeriodID`,{from:{type:db.sql.Date,value:from},to:{type:db.sql.Date,value:f.to}}),
  query(`/* NATIVE_SALES_TARGETS */ SELECT t.PeriodID,t.EmpID,e.EmpCode,e.EmpName SalesName,COUNT(*) TargetRows,SUM(t.PeriodTarget) TargetAmt
   FROM dbo.EMSaleTarget t JOIN dbo.EMSalePeriod p ON p.PeriodID=t.PeriodID LEFT JOIN dbo.EMEmp e ON e.EmpID=t.EmpID
   WHERE p.BeginDate<=@to AND p.EndDate>=@from AND (@empCode='' OR e.EmpCode=@empCode)
   GROUP BY t.PeriodID,t.EmpID,e.EmpCode,e.EmpName`,{from:{type:db.sql.Date,value:from},to:{type:db.sql.Date,value:f.to},empCode:{type:db.sql.NVarChar(100),value:f.empCode}}),
 ]);
 const periods=periodsResult.recordset||[],targets=targetsResult.recordset||[],state=coverage(periods,from,f.to),byEmployee=new Map();
 const key=r=>r.EmpID==null?'UNASSIGNED':String(r.EmpID);
 for(const r of actual.rows){const k=key(r);if(!byEmployee.has(k))byEmployee.set(k,{EmpID:r.EmpID,EmpCode:r.EmpCode||'',SalesName:r.SalesName||'ไม่ระบุพนักงานขาย',ActualTon:0,ActualAmt:0});const e=byEmployee.get(k);e.ActualTon+=Number(r.QtyTon||0);e.ActualAmt+=Number(r.Amount||0);}
 for(const t of targets){const k=key(t);if(!byEmployee.has(k))byEmployee.set(k,{EmpID:t.EmpID,EmpCode:t.EmpCode||'',SalesName:t.SalesName||'ไม่ระบุพนักงานขาย',ActualTon:0,ActualAmt:0});}
 let duplicates=0,missing=0;
 const labels={NOT_CONFIGURED:'ยังไม่กำหนดงวดเป้า',PERIOD_MISMATCH:'ช่วงรายงานไม่ตรงงวดเป้าเต็ม',MISSING_TARGET:'ยังไม่กำหนดเป้ารายเซลล์',DUPLICATE_TARGET:'เป้ารายเซลล์ซ้ำในงวด',INVALID_TARGET:'เป้าไม่ถูกต้อง',PARTIAL_ACTUAL:'ยอดขายยังไม่ครบช่วง',MATCHED:'ตรงงวดเป้า'};
 const rows=[...byEmployee.values()].map(e=>{
  const ts=targets.filter(t=>key(t)===key(e));let s=state,target=null;
  if(s==='MATCHED'){
   if(ts.some(t=>Number(t.TargetRows)!==1)){s='DUPLICATE_TARGET';duplicates++;}
   else if(ts.length!==periods.length){s='MISSING_TARGET';missing++;}
   else if(ts.some(t=>t.TargetAmt==null||!Number.isFinite(Number(t.TargetAmt))||Number(t.TargetAmt)<0))s='INVALID_TARGET';
   else target=ts.reduce((n,t)=>n+Number(t.TargetAmt),0);
  }
  if(actual.meta?.isTruncated)s='PARTIAL_ACTUAL';
  return {EmpCode:e.EmpCode,SalesName:e.SalesName,ActualTon:Number(e.ActualTon.toFixed(4)),ActualAmt:Number(e.ActualAmt.toFixed(2)),TargetAmt:target,AchievedPct:s==='MATCHED'&&target>0?Number((e.ActualAmt/target*100).toFixed(2)):null,TargetState:labels[s]};
 }).sort((a,b)=>a.EmpCode.localeCompare(b.EmpCode));
 return {columns,rows,meta:{...actual.meta,filters:{from:f.from,to:f.to,empCode:f.empCode},dateBasis:'SALES_ADJUSTMENT_DOCUMENT_DATE',amountBasis:'EXCLUDING_VAT',targetCoverage:state,duplicateTargetCount:duplicates,missingTargetCount:missing,notes:['ยอดจริงคือ 107/108 หักลดหนี้หรือรับคืน 109 และเพิ่มหนี้ 110 ตามวันที่เอกสาร ไม่รวมใบจอง 103 หรือใบสั่งขาย 104','เป้ายอดขายอ่านจากงวดและเป้ารายเซลล์ WinSpeed เทียบเฉพาะงวดเต็มที่ตรงช่วงรายงาน ไม่เฉลี่ยเป้ารายวัน','ไม่มีเป้าหรือเป้าซ้ำจะแสดงค่าว่างและงดคำนวณเปอร์เซ็นต์ ไม่ใช้เป้าสมมติ',`เริ่มข้อมูลที่ ${businessDate}; เป้าจำนวนตันไม่ได้กำหนดจากต้นทางรายงานนี้`]}};
}
module.exports={run,columns,coverage};
