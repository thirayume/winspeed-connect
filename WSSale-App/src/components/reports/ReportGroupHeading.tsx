import type {ReportData} from '../../services/api';
export function reportGroupKey(data:ReportData,row:Record<string,unknown>){return JSON.stringify((data.meta?.groupBy||[]).map(k=>row[k]));}
const cache=new WeakMap<ReportData,Map<string,{count:number;amount:number}>>();
function groups(data:ReportData){let all=cache.get(data);if(!all){all=new Map();for(const r of data.rows){const key=reportGroupKey(data,r),g=all.get(key)||{count:0,amount:0};g.count++;g.amount+=Number(r.Amount)||0;all.set(key,g);}cache.set(data,all);}return all;}
export function ReportGroupHeading({data,row,previous,colSpan}:{data:ReportData;row:Record<string,unknown>;previous?:Record<string,unknown>;colSpan:number}){
 const fields=data.meta?.groupBy;if(!fields?.length)return null;
 const key=reportGroupKey(data,row);if(previous&&reportGroupKey(data,previous)===key)return null;
 const summary=groups(data).get(key)!;
 return <tr className="bg-blue-50 text-[#0C447C] border-y border-blue-200" data-testid="report-group"><td colSpan={colSpan} className="p-2 text-xs font-bold">{fields.map(k=>String(row[k]??'ไม่ระบุ')).join(' · ')} {fields.includes('CustCode')?String(row.CustName||''):''} {fields.includes('GoodCode')?String(row.GoodName||''):''} · {summary.count} รายการ · ยอดสุทธิ {summary.amount.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td></tr>;
}
