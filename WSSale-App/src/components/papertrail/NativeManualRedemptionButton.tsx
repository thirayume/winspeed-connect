import {useState} from 'react';
import {createPortal} from 'react-dom';
import {req} from '../../services/api';
import {useCan} from '../../utils/capabilities';

type ManualRequest={requestId:string;status:string;reason:string;receiver:string;plate:string;
 expiresAt:string|null;isRequester:boolean;canApprove:boolean;selfApproval:boolean|null};
type Preview={soid:number;fingerprint:string;deliveryNo:string;couponNo:string;qty:string;
 completed:boolean;canCreate:boolean;request:ManualRequest|null;redemptionNo?:string};
const errors:Record<string,string>={
 MR_NOT_ENABLED:'ยังไม่เปิดขั้น 116 สำหรับสภาพแวดล้อมนี้',
 MR_DELIVERY_DIVERGED:'ข้อมูลใบสั่งขายหรือตั๋วเปลี่ยน กรุณาให้ผู้ดูแลตรวจสอบ',
 MR_SOURCE_NOT_FOUND:'ไม่พบใบสั่งขายและตั๋วที่รองรับขั้นนี้',
 MR_SOURCE_UNAVAILABLE:'ตั๋วนี้มีการใช้หรือข้อมูลประกอบอื่นแล้ว กรุณาตรวจสอบ',
 MR_PREVIEW_STALE:'ข้อมูลเปลี่ยนระหว่างทำรายการ กรุณาตรวจใหม่',
 MR_APPROVAL_FORBIDDEN:'อนุมัติคำขอผู้อื่นได้เฉพาะผู้จัดการ ผู้บริหาร หรือผู้ดูแล',
 MR_APPROVAL_REQUIRED:'ต้องได้รับอนุมัติคำขอที่ยังไม่หมดอายุก่อน',
 MR_REQUEST_OWNED_BY_ANOTHER:'มีคำขอของผู้อื่นอยู่แล้ว ให้ผู้ขอเดิมดำเนินการต่อ',
 MR_REQUEST_CONFLICT:'คำขอเปลี่ยนหรือดำเนินการไปแล้ว กรุณาตรวจใหม่',
 MR_REQUEST_CHANGED:'เหตุผลหรือหลักฐานเปลี่ยนหลังอนุมัติ กรุณาตรวจสอบและขอใหม่',
 MR_APPROVER_MAPPING_REQUIRED:'ผู้อนุมัติยังไม่ผูกพนักงาน WinSpeed กรุณาให้ผู้ดูแลตรวจสอบ',
 MR_APPROVER_NOT_LISTED:'พนักงานของผู้อนุมัติไม่อยู่ในรายชื่อผู้อนุมัติเอกสาร WinSpeed กรุณาให้ผู้ดูแลเพิ่มรายชื่อ',
 MR_RECORDER_MAPPING_REQUIRED:'ผู้ทำรายการยังไม่ผูกพนักงาน WinSpeed (ใช้เป็นผู้บันทึกใบ 116) กรุณาให้ผู้ดูแลตรวจสอบ',
 MR_SIMULATION_DETAILS_REQUIRED:'กรอกเหตุผลอย่างน้อย 10 ตัวอักษร ผู้รับขึ้นต้น UAT2 และทะเบียนขึ้นต้น UAT2-',
 MR_COUNTER_UNSUPPORTED:'เลขรันใบขนยังไม่พร้อม กรุณาให้ผู้ดูแลตรวจสอบ',
};
export function NativeManualRedemptionButton({soid,onCreated}:{soid:string|number;onCreated:()=>void}){
 const can=useCan();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null),[key,setKey]=useState({basis:'',id:''});
 const [reason,setReason]=useState(''),[receiver,setReceiver]=useState('UAT2 TEST'),[plate,setPlate]=useState('UAT2-TEST');
 if(!can('coupon.manual116'))return null;
 function showError(e:unknown){const code=(e as {data?:{code?:string}}).data?.code||'';setError(errors[code]||'ดำเนินการไม่สำเร็จ กรุณาตรวจสถานะหรือติดต่อผู้ดูแล');}
 async function inspect(){setOpen(true);setBusy(true);setError('');try{
  const p=await req<Preview>(`/so/${soid}/native-redemption/preview`);setPreview(p);
  setKey(old=>old.basis===p.fingerprint?old:{basis:p.fingerprint,id:crypto.randomUUID()});
 }catch(e){showError(e);}finally{setBusy(false);}}
 async function act(action:'request'|'approve'|'apply'){
  if(!preview||busy)return;setBusy(true);setError('');
  const id=action==='request'?key.id:preview.request?.requestId;
  if(!id){setBusy(false);return;}
  const base=`/so/${soid}/native-redemption`;
  const url=action==='request'?base+'/requests':action==='approve'?base+'/requests/'+id+'/approve':base;
  try{await req(url,{method:'POST',body:JSON.stringify({requestId:id,fingerprint:preview.fingerprint,reason,receiver,plate})});await inspect();if(action==='apply')onCreated();}
  catch(e){showError(e);}finally{setBusy(false);}
 }
 const r=preview?.request,expired=Boolean(r?.expiresAt&&Date.parse(r.expiresAt)<=Date.now());
 return <>
  <button disabled={busy} onClick={inspect} className="rounded-lg border border-amber-700 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">ตัดตั๋ว 116 · ทดสอบ UAT</button>
  {open&&createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="ทดสอบตัดตั๋ว 116"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
   <h2 className="text-lg font-bold text-[#0C447C]">ตัดตั๋ว 116 · ข้อยกเว้นแบบระบุผู้อนุมัติ</h2>
   <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">รอบจำลอง UAT2 เท่านั้น ไม่มีเครื่องชั่งและหลักฐานส่งจริง รายการนี้ไม่รับรองน้ำหนักหรือการส่งสินค้า</p>
   {preview&&<div className="mt-3 space-y-3 text-sm">{preview.completed?<p>บันทึกใบขนแล้ว: <strong>{preview.redemptionNo}</strong></p>:<>
    <p>104 {preview.deliveryNo} · ตั๋ว {preview.couponNo} · เต็มจำนวน {Number(preview.qty).toLocaleString('th-TH')} ตัน</p>
    {r&&<div className="rounded-lg bg-slate-50 p-3"><p>สถานะ {expired?'อนุมัติหมดอายุ':r.status==='APPROVED'?'อนุมัติแล้ว':'รออนุมัติ'}</p><p>เหตุผล: {r.reason}</p><p>ผู้รับ: {r.receiver} · ทะเบียน: {r.plate}</p><p>หลักฐาน: snapshot ใบสั่งขายและตั๋วใน UAT ไม่ใช่ผลชั่ง</p></div>}
    {preview.canCreate&&(!r||(r.isRequester&&expired))&&<>
     <label className="block">เหตุผลการจำลอง<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border p-2" /></label>
     <label className="block">ผู้รับทดสอบ<input value={receiver} onChange={e=>setReceiver(e.target.value)} maxLength={100} className="mt-1 w-full rounded-lg border p-2" /></label>
     <label className="block">ทะเบียนทดสอบ<input value={plate} onChange={e=>setPlate(e.target.value)} maxLength={25} className="mt-1 w-full rounded-lg border p-2" /></label>
    </>}
    {!r&&!preview.canCreate&&<p>รอคลังหรือบัญชีสร้างคำขอก่อน ผู้จัดการจึงตรวจอนุมัติได้</p>}
    {r?.canApprove&&<p>อนุมัติของตนเองได้ตามสิทธิ์ ระบบบันทึกผู้ใช้งานจริงแม้ใช้ Access As</p>}
   </>}</div>}
   {busy&&!preview&&<p className="mt-3 text-sm">กำลังตรวจสอบ…</p>}
   {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
   <div className="mt-5 flex flex-wrap justify-end gap-2 text-sm">
    <button disabled={busy} onClick={()=>setOpen(false)} className="rounded-lg border px-3 py-2">ปิด</button>
    {preview&&!preview.completed&&<>
     <button disabled={busy} onClick={inspect} className="rounded-lg border px-3 py-2">ตรวจใหม่</button>
     {preview.canCreate&&(!r||(r.isRequester&&expired))&&<button disabled={busy||reason.trim().length<10} onClick={()=>act('request')} className="rounded-lg bg-amber-700 px-3 py-2 text-white">ส่งคำขอ</button>}
     {r?.canApprove&&<button disabled={busy} onClick={()=>act('approve')} className="rounded-lg bg-blue-800 px-3 py-2 text-white">อนุมัติคำขอ</button>}
     {r?.isRequester&&r.status==='APPROVED'&&!expired&&<button disabled={busy} onClick={()=>act('apply')} className="rounded-lg bg-blue-800 px-3 py-2 text-white">ยืนยันตัดตั๋วเต็มจำนวน</button>}
    </>}
   </div>
  </div></div>,document.body)}
 </>;
}
