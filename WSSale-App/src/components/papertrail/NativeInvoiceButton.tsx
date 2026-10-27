import {useState} from 'react';
import {createPortal} from 'react-dom';
import {req} from '../../services/api';
import {useCan} from '../../utils/capabilities';

type Preview={completed:boolean;fingerprint?:string;invoiceDate:string;dueDate?:string;series?:string;
 amount?:string;qty?:string;deliveryNo?:string;couponNo?:string;redemptionNo?:string;invoiceNo?:string};
const errors:Record<string,string>={
 IP_NOT_ENABLED:'ยังไม่เปิด Post Invoice สำหรับสภาพแวดล้อมนี้',
 IP_MANUAL_116_REQUIRED:'ต้องมีใบตัดตั๋ว 116 ที่ผ่านขั้นจำลอง UAT ก่อน',
 IP_SOURCE_NOT_FOUND:'ไม่พบเอกสารต้นทางที่รองรับขั้นนี้',
 IP_SOURCE_UNAVAILABLE:'เอกสารมีการใช้หรือข้อมูลประกอบอื่นแล้ว กรุณาตรวจสอบ',
 IP_DELIVERY_DIVERGED:'ข้อมูลใบสั่งขายหรือตั๋วเปลี่ยน กรุณาให้ผู้ดูแลตรวจสอบ',
 IP_REDEMPTION_DIVERGED:'ใบตัดตั๋วหรือข้อมูลอนุมัติเปลี่ยน กรุณาให้ผู้ดูแลตรวจสอบ',
 IP_PREVIEW_STALE:'ข้อมูลเปลี่ยนระหว่างทำรายการ กรุณาตรวจใหม่',
 IP_REQUEST_CONFLICT:'คำขอนี้ดำเนินการแล้วหรือข้อมูลไม่ตรง กรุณาตรวจสถานะ',
 IP_DATE_OVERRIDE_UNVERIFIED:'รอบทดสอบนี้ใช้วันที่ตามใบตัดตั๋ว 116',
 IP_COST_SCOPE_UNSUPPORTED:'พบข้อมูลต้นทุนที่ต้องตรวจเพิ่มเติม ยังไม่รองรับการ Post ในกรณีนี้',
 IP_METADATA_UNSUPPORTED:'กติกาฐานข้อมูลเปลี่ยน กรุณาให้ผู้ดูแลตรวจสอบก่อน Post',
 IP_PERIOD_UNSUPPORTED:'งวดบัญชีของวัน Invoice ยังไม่พร้อม กรุณาให้ผู้ดูแลตรวจสอบ',
 IP_COUNTER_UNSUPPORTED:'เลขรัน Invoice ยังไม่พร้อม กรุณาให้ผู้ดูแลตรวจสอบ',
};
const date=(v?:string)=>v?new Date(v+'T00:00:00').toLocaleDateString('th-TH'):'—';
export function NativeInvoiceButton({soid,onCreated}:{soid:string|number;onCreated:()=>void}){
 const can=useCan();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null),[key,setKey]=useState({basis:'',id:''});
 if(!can('invoice.post-native'))return null;
 function showError(e:unknown){const code=(e as {data?:{code?:string}}).data?.code||'';setError(errors[code]||'ดำเนินการไม่สำเร็จ กรุณาตรวจสถานะหรือติดต่อผู้ดูแล');}
 async function inspect(){setOpen(true);setBusy(true);setError('');setPreview(null);try{
  const p=await req<Preview>(`/so/${soid}/native-invoice/preview`);setPreview(p);
  setKey(old=>old.basis===p.fingerprint?old:{basis:p.fingerprint||'',id:crypto.randomUUID()});
 }catch(e){showError(e);}finally{setBusy(false);}}
 async function post(){
  if(!preview?.fingerprint||preview.completed||busy)return;
  setBusy(true);setError('');
  try{const result=await req<Preview>(`/so/${soid}/native-invoice`,{method:'POST',body:JSON.stringify({requestId:key.id,fingerprint:preview.fingerprint,invoiceDate:preview.invoiceDate})});setPreview(result);onCreated();}
  catch(e){showError(e);}finally{setBusy(false);}
 }
 return <>
  <button disabled={busy} onClick={inspect} className="rounded-lg border border-blue-800 px-3 py-2 text-xs font-bold text-blue-900 disabled:opacity-50">Post Invoice · ทดสอบ UAT</button>
  {open&&createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="ทดสอบ Post Invoice"><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
   <h2 className="text-lg font-bold text-[#0C447C]">Post Invoice 107 · ACCOUNTING</h2>
   <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">จำลอง UAT2 จากใบตัดตั๋ว ไม่มีหลักฐานชั่งหรือส่งจริง การยืนยันจะออก Invoice และตัดสต็อกเต็มจำนวน</p>
   {preview&&<div className="mt-3 space-y-2 text-sm">{preview.completed?<p>บันทึก Invoice แล้ว: <strong>{preview.invoiceNo}</strong> · {date(preview.invoiceDate)}</p>:<>
    <p>104 {preview.deliveryNo} · ตั๋ว {preview.couponNo}</p><p>ใบตัดตั๋ว 116: {preview.redemptionNo}</p>
    <p>Invoice เล่ม {preview.series} · วันที่ {date(preview.invoiceDate)} · ครบกำหนด {date(preview.dueDate)}</p>
    <p>เต็มจำนวน {Number(preview.qty).toLocaleString('th-TH')} ตัน · {Number(preview.amount).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท</p>
    <p>ยอดลูกหนี้เกิดจากตั๋วเดิมแล้ว ขั้นนี้เชื่อม Invoice กับตั๋วและตัดสต็อก</p>
   </>}</div>}
   {busy&&!preview&&<p className="mt-3 text-sm">กำลังตรวจสอบ…</p>}
   {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
   <div className="mt-5 flex justify-end gap-2 text-sm"><button disabled={busy} onClick={()=>setOpen(false)} className="rounded-lg border px-3 py-2">ปิด</button>
    {!preview?.completed&&<button disabled={busy} onClick={inspect} className="rounded-lg border px-3 py-2">ตรวจใหม่</button>}
    {preview&&!preview.completed&&!error&&<button disabled={busy} onClick={post} className="rounded-lg bg-blue-800 px-3 py-2 text-white">ยืนยัน Post Invoice และตัดสต็อก</button>}
   </div>
  </div></div>,document.body)}
 </>;
}
