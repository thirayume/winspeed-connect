import { useState } from 'react';
import { createPortal } from 'react-dom';
import { req } from '../../services/api';
import { useCan } from '../../utils/capabilities';
import { deliveryError } from '../sales/NativeDeliveryButton';

type Row={soid:number;requestId:string;fingerprint:string;docuNo:string;aiNo:string;amount:string};
export function NativeCreditRequests({onApproved}:{onApproved:()=>void}) {
 const can=useCan();const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState<Row|null>(null),[reason,setReason]=useState('');
 if(!can('credit.approve-native'))return null;
 async function load(){setOpen(true);setBusy(true);setError('');try{setRows(await req<Row[]>('/so/native-delivery/requests'));}catch(e){setError(deliveryError(e));}finally{setBusy(false);}}
 async function approve(){if(!selected||busy||reason.trim().length<5)return;setBusy(true);setError('');
  try{await req(`/so/${selected.soid}/native-delivery/requests/${selected.requestId}/approve`,{method:'POST',body:JSON.stringify({fingerprint:selected.fingerprint,reason:reason.trim()})});
   setSelected(null);setReason('');await load();onApproved();
  }catch(e){setError(deliveryError(e));}finally{setBusy(false);}}
 return <>
  <button disabled={busy} onClick={load} className="whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">อนุมัติเกินวงเงิน 104</button>
  {open&&createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Account อนุมัติเกินวงเงิน 104">
   <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
    <h2 className="text-lg font-bold text-[#0C447C]">Account อนุมัติเกินวงเงิน 104</h2>
    <p className="my-3 text-sm">อนุมัติได้รวมคำขอของตนเอง ระบบบันทึกผู้ขอและผู้อนุมัติจริงพร้อมผู้ใช้ที่ Access As คำอนุมัติมีอายุ 30 นาที และใช้ได้เมื่อข้อมูลเอกสารยังตรงกัน</p>
    {rows.map(row=><button key={row.requestId} disabled={busy} onClick={()=>{setSelected(row);setReason('');}} className="my-1 w-full rounded-lg border p-3 text-left text-sm">
     {row.docuNo} · {row.aiNo} · {Number(row.amount).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท
    </button>)}
    {!busy&&rows.length===0&&<p className="py-3 text-sm text-gray-500">ไม่มีคำขอรออนุมัติ</p>}
    {selected&&<div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">
     <p className="font-bold">ยืนยันอนุมัติ {selected.docuNo}</p>
     <label className="mt-2 block">เหตุผลอนุมัติเกินวงเงิน<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} disabled={busy} className="mt-1 w-full rounded-lg border p-2" /></label>
     <button disabled={busy||reason.trim().length<5} onClick={approve} className="mt-2 rounded-lg bg-amber-800 px-3 py-2 font-bold text-white disabled:opacity-50">ยืนยันอนุมัติวงเงิน</button>
    </div>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex justify-end gap-2 text-sm"><button disabled={busy} onClick={load} className="rounded-lg border px-3 py-2">โหลดใหม่</button><button disabled={busy} onClick={()=>setOpen(false)} className="rounded-lg border px-3 py-2">ปิด</button></div>
   </div>
  </div>,document.body)}
 </>;
}
