import type {BudgetReportProject} from './budgetPlan';
export type BudgetDetailRow={label:string;value:string};
export function budgetDetailPages(projects:BudgetReportProject[],landscape:boolean,pageHeight=landscape?210:297){
 const rows:BudgetDetailRow[]=[];
 const segmenter=new Intl.Segmenter('th',{granularity:'word'}),graphemes=new Intl.Segmenter('th',{granularity:'grapheme'});
 const add=(label:string,value:unknown)=>{const parts:string[]=[];let chunk='';for(const word of segmenter.segment(String(value??''))){
   const letters=Array.from(graphemes.segment(word.segment),v=>v.segment);
   for(let at=0;at<letters.length;at+=60){const part=letters.slice(at,at+60).join('');if(chunk&&Array.from(graphemes.segment(chunk+part)).length>60){parts.push(chunk);chunk='';}chunk+=part;}
  }if(chunk)parts.push(chunk);if(!parts.length)parts.push('—');parts.forEach((text,i)=>rows.push({label:i?label+' (ต่อ)':label,value:text}));};
 for(const p of projects){add('โครงการ',p.title);add('หมวด / อ้างอิง',`${p.category} · ${p.refDoc||'—'}`);add('ภาค / วงเงิน',`${p.region} · ${p.budgetAmount==null?'ยังไม่ได้กำหนด':Number(p.budgetAmount).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท`);add('ระยะเวลา',`${p.validFrom} – ${p.validTo}`);add('วัตถุประสงค์',p.objective);add('สินค้า / สิทธิประโยชน์อ้างอิง',`${p.goodCodePattern||'—'} · ${p.returnType} · NET ${p.netPrice??'—'}`);add('หมายเหตุ',p.note);
 for(const v of p.internalParticipants)add('ผู้ร่วมงานภายใน',`${v.name} · ${v.role} · ${v.dept}`);
 for(const v of p.externalParticipants)add('ผู้ร่วมงานภายนอก',`${v.custName} · ${v.custCode} · ${v.note}`);
 }
 const size=Math.max(1,Math.floor(((pageHeight-16)*96/25.4-220)/60));return Array.from({length:Math.ceil(rows.length/size)},(_,i)=>rows.slice(i*size,(i+1)*size));
}
