import type {CustomerCreditStatus} from '../../types';
export function NativeCreditSummary({credit}:{credit:CustomerCreditStatus|null}){
 if(!credit)return null;
 const money=(n:number)=>Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
 return <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
  <p className="font-bold">เครดิตและหนี้คงค้างสำหรับพิจารณา</p>
  <p>วงเงิน {Number(credit.creditLimit)>0?money(Number(credit.creditLimit))+' บาท':'ไม่จำกัด'} · ยอดค้างทั้งหมด {money(credit.totalOutstanding)} บาท</p>
  <p>รวมบิลนี้ {money(credit.totalWithOrder??credit.projectedTotal??0)} บาท · อายุหนี้สูงสุด {credit.maxAgingDays} วัน</p>
  {!!credit.openingOverdueCount&&<p>หนี้เกินกำหนดยกมา {credit.openingOverdueCount} ใบ รวม {money(credit.openingOverdueAmount||0)} บาท</p>}
  {credit.creditHold&&<p className="font-bold text-red-700">ลูกค้าถูกระงับเครดิต ต้องให้ฝ่ายการเงินปลดระงับก่อนออก 104</p>}
  {[...(credit.blockReasons||[]),...(credit.warnings||[])].map((s,i)=><p key={i} className="text-amber-900">{s}</p>)}
 </div>;
}
