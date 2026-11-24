'use strict';
const XLSX=require('xlsx');
function workbook(data){
 const wb=XLSX.utils.book_new(),stamp=data.isoStamp?`${data.isoStamp.code} Rev.${data.isoStamp.revision} ${data.isoStamp.effectiveDate||''}`:'';
 function add(name,rows){const sheet=XLSX.utils.aoa_to_sheet([[data.title],[stamp],...rows]);sheet['!cols']=[{wch:22},{wch:30},{wch:35},{wch:24},{wch:24},{wch:20},{wch:20}];XLSX.utils.book_append_sheet(wb,sheet,name);}
 const context=[['รอบปี',data.meta?.periodFrom||'',data.meta?.periodTo||''],['ฐานข้อมูลรายงาน',data.meta?.basis||''],['เงื่อนไข',JSON.stringify(data.meta?.filters||{})]];
 if(data.meta?.missingPlanDetailsCount)context.push(['ข้อมูลไม่ครบ: แผนเดิมยังไม่มีรายละเอียดประมาณการ',data.meta.missingPlanDetailsCount]);
 if(data.meta?.budgetSummary?.length)context.push(['ภาค / หน่วยงาน','วงเงินรายปี','ประมาณการ','คงเหลือหลังประมาณการ'],...data.meta.budgetSummary.map(s=>[s.region,s.allocatedAmount,s.estimatedAmount,Math.round((s.allocatedAmount-s.estimatedAmount)*100)/100]));
 const totals=data.columns.map((c,i)=>i===0?'รวมข้อมูลที่แสดง':c.aggregation==='sum'?data.rows.reduce((s,r)=>s+Math.round(Number(r[c.key]||0)*100),0)/100:'');
 add('Report',[...context,[],data.columns.map(c=>c.label),...data.rows.map(r=>data.columns.map(c=>r[c.key]??'')),totals]);
 add('Annual Summary',[['รอบปี',data.meta?.periodFrom||'',data.meta?.periodTo||''],['ฐานข้อมูลรายงาน',data.meta?.basis||''],['ภาค / หน่วยงาน','วงเงินรายปี','ประมาณการ','คงเหลือหลังประมาณการ'],...(data.meta?.budgetSummary||[]).map(s=>[s.region,s.allocatedAmount,s.estimatedAmount,s.allocatedAmount-s.estimatedAmount])]);
 const projects=data.meta?.projects||[];
 if(projects.length){add('Projects',[['โครงการ','หมวด','อ้างอิง','ภาค','วงเงิน','เริ่ม','ถึง','วัตถุประสงค์','สูตรอ้างอิง','สิทธิประโยชน์','ราคา NET อ้างอิง','หมายเหตุ'],...projects.map(p=>[p.title,p.category,p.refDoc,p.region,p.budgetAmount??'',p.validFrom,p.validTo,p.objective,p.goodCodePattern,p.returnType,p.netPrice??'',p.note])]);
 add('Participants',[['โครงการ','ประเภท','ชื่อ / ลูกค้า','ตำแหน่ง / รหัสลูกค้า','แผนก / หมายเหตุ'],...projects.flatMap(p=>[...(p.internalParticipants||[]).map(v=>[p.title,'ภายใน',v.name,v.role,v.dept]),...(p.externalParticipants||[]).map(v=>[p.title,'ภายนอก',v.custName,v.custCode,v.note])])]);}
 if(data.meta?.signatures)add('Approval',[['ขั้น','ผู้ลงนาม','เวลา (UTC)'],...['prepared','reviewed','approved'].map(k=>[k,data.meta.signatures[k]||'',data.meta.signatures[k+'At']||''])]);
 return wb;
}
module.exports={workbook};
