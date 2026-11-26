import {toThaiDateInputFormat} from '../../utils/date';
export function DocumentDate({date,draftDate,isDraft=false}:{date?:string|null;draftDate?:string|null;isDraft?:boolean}){
 const actual=date?toThaiDateInputFormat(date.slice(0,10)):'';
 return <span className="block text-[11px] text-slate-500">{actual?`DocuDate: ${actual} พ.ศ.`:isDraft?`DocuDate: ยังไม่ออกเอกสาร${draftDate?' · ร่าง '+toThaiDateInputFormat(draftDate.slice(0,10))+' พ.ศ.':''}`:'DocuDate: ไม่พบวันที่เอกสาร'}</span>;
}
