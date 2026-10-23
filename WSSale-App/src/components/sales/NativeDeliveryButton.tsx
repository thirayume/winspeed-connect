import { useState } from 'react';
import { createPortal } from 'react-dom';
import { req } from '../../services/api';
import { useCan } from '../../utils/capabilities';

type Request = { requestId: string; status: string; expiresAt: string | null; isRequester: boolean };
type Preview = { soid: number; docuNo: string; aiNo: string; amount: string; fingerprint: string;
  request: Request | null; completed: boolean; deliveryNo?: string };
const messages: Record<string,string> = {
  DO_SOURCE_CHANGED: 'ข้อมูลใบจองเปลี่ยนหลังยืนยัน กรุณาตรวจสอบเอกสาร',
  DO_ORIGIN_REQUIRED: 'ใบนี้ยังไม่รองรับการออก 104 ผ่านแอป กรุณาใช้ใบจองใหม่จากแอป',
  DO_SOURCE_UNAVAILABLE: 'สถานะใบจองหรือ AI ยังไม่พร้อมออก 104',
  DO_CONTRACT_UNSUPPORTED: 'ใบนี้มีเงื่อนไขที่ยังไม่รองรับการออก 104 ผ่านแอป',
  DO_CREDIT_CONTRACT_UNSUPPORTED: 'เงื่อนไขเครดิตลูกค้ารายนี้ยังไม่รองรับ กรุณาให้ฝ่ายบัญชีตรวจสอบ',
  DO_PREVIEW_STALE: 'ข้อมูลเปลี่ยนระหว่างดำเนินการ กรุณาตรวจสถานะและขออนุมัติใหม่',
  DO_CREDIT_APPROVAL_REQUIRED: 'ต้องได้รับอนุมัติวงเงินจาก Account ที่ยังไม่หมดอายุก่อน',
  DO_REQUEST_CONFLICT: 'คำขอนี้เปลี่ยนแปลงหรือดำเนินการแล้ว กรุณาตรวจสถานะอีกครั้ง',
  DO_REQUEST_OWNED_BY_ANOTHER: 'มีคำขอจากผู้ใช้อื่นอยู่แล้ว กรุณาให้ผู้ขอดำเนินการต่อ',
  DO_RECEIPT_DIVERGED: 'เอกสารปลายทางมีการเปลี่ยนแปลง กรุณาให้ผู้ดูแลตรวจสอบ',
};
export function deliveryError(e: unknown) {
  const code=(e as {data?:{code?:string}}).data?.code;
  return messages[code||''] || 'ดำเนินการไม่สำเร็จ กรุณาตรวจสถานะอีกครั้งหรือติดต่อผู้ดูแล';
}
export function NativeDeliveryButton({soid,onCreated}:{soid:string|number;onCreated:()=>void}) {
 const can=useCan();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);
 const [key,setKey]=useState({basis:'',id:''});
 if(!can('so.create-native-delivery')) return null;
 async function inspect() {
  setOpen(true);setBusy(true);setError('');
  try {
   const p=await req<Preview>(`/so/${soid}/native-delivery/preview`);setPreview(p);
   const basis=p.fingerprint+':'+(p.request?.requestId||'');
   setKey(old=>old.basis===basis?old:{basis,id:crypto.randomUUID()});
  }catch(e){setError(deliveryError(e));}finally{setBusy(false);}
 }
 async function request() {
  if(!preview||busy)return;setBusy(true);setError('');
  try {
   await req(`/so/${soid}/native-delivery/requests`,{method:'POST',body:JSON.stringify({requestId:key.id,fingerprint:preview.fingerprint})});
   await inspect();
  }catch(e){setError(deliveryError(e));}finally{setBusy(false);}
 }
 async function create() {
  if(!preview?.request||busy)return;setBusy(true);setError('');
  try {
   const r=await req<{deliveryNo:string}>(`/so/${soid}/native-delivery`,{method:'POST',body:JSON.stringify({requestId:preview.request.requestId,fingerprint:preview.fingerprint})});
   setPreview({...preview,completed:true,deliveryNo:r.deliveryNo});onCreated();
  }catch(e){setError(deliveryError(e));}finally{setBusy(false);}
 }
 const r=preview?.request;
 const expired=Boolean(r?.expiresAt && Date.parse(r.expiresAt)<=Date.now());
 return <>
  <button onClick={inspect} disabled={busy} className="rounded-lg bg-blue-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">ออกใบสั่งขาย 104</button>
  {open&&createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="ออกใบสั่งขาย 104">
   <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
    <h2 className="text-lg font-bold text-[#0C447C]">ออกใบสั่งขาย 104</h2>
    {preview&&<div className="mt-3 space-y-2 text-sm">
     {preview.completed?<p>ออกเอกสารแล้ว: <strong>{preview.deliveryNo}</strong></p>:<>
      <p>ใบจอง {preview.docuNo} · AI {preview.aiNo}</p><p>เต็มจำนวน · ยอด {Number(preview.amount).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท</p>
      <p>ใบนี้เกินวงเงินเครดิต ต้องให้ Account อนุมัติก่อนออกเอกสาร</p>
      {r&&<p>{expired?'คำอนุมัติหมดอายุ กรุณาขอใหม่':r.status==='APPROVED'?'Account อนุมัติแล้ว':'ส่งคำขอแล้ว รอ Account อนุมัติ'}</p>}
      {r&&!r.isRequester&&<p>ให้ผู้ขอเดิมเป็นผู้ออกเอกสารหลังอนุมัติ</p>}
     </>}
     <p className="rounded-lg bg-amber-50 p-3 text-amber-900">เอกสารนี้ยังไม่ยืนยันการส่งสินค้า ต้องดำเนินขั้นตอนชั่งและตัดตั๋วให้ครบก่อน</p>
    </div>}
    {busy&&!preview&&<p className="mt-3 text-sm">กำลังตรวจสอบ…</p>}
    {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2 text-sm">
     <button disabled={busy} onClick={()=>setOpen(false)} className="rounded-lg border px-3 py-2">ปิด</button>
     {preview&&!preview.completed&&<>
      <button disabled={busy} onClick={inspect} className="rounded-lg border px-3 py-2">ตรวจสถานะอีกครั้ง</button>
      {(!r||(r.isRequester&&expired))&&<button disabled={busy} onClick={request} className="rounded-lg bg-amber-700 px-3 py-2 text-white">ขอ Account อนุมัติเกินวงเงิน</button>}
      {r?.isRequester&&r.status==='APPROVED'&&!expired&&<button disabled={busy} onClick={create} className="rounded-lg bg-blue-800 px-3 py-2 font-bold text-white">ยืนยันออก 104 เต็มจำนวน</button>}
     </>}
    </div>
   </div>
  </div>,document.body)}
 </>;
}
