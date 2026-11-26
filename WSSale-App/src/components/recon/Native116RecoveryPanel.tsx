import {useEffect,useRef,useState} from 'react';
import {req} from '../../services/api';
import {useAuthStore} from '../../store/auth-store';
import {DocumentDate} from '../common/DocumentDate';
type Item={stageId:string;docuNo:string|null;docuDate:string|null;connectionOpen:number};
type Preview={stageId:string;fingerprint:string;connectionOpen:boolean;restoreExisting:boolean;docuNo:string|null;docuDate:string|null;coupons:{couponId:number;couponNo:string;restoreBalance:string;currentBalance:string}[]};
const message=(e:unknown)=>{
 const code=(e as {data?:{code?:string}}).data?.code;
 if(code==='ND_NATIVE116_CLOSE_ORIGINAL_CONNECTION'||code==='NATIVE_116_RECOVERY_CLOSE_ORIGINAL_CONNECTION')return 'กรุณาปิด WinSpeed ที่ทำรายการค้าง แล้วโหลดตรวจใหม่ก่อนกู้รายการ';
 if(code==='ND_PREVIEW_STALE'||code==='NATIVE_116_RECOVERY_PREVIEW_CHANGED')return 'ข้อมูลเปลี่ยนแล้ว กรุณาตรวจภาพล่าสุดอีกครั้ง';
 return `ยังไม่สามารถกู้รายการได้ กรุณาตรวจสิทธิ์และข้อมูล (${code||'กรุณาลองใหม่'})`;
};
export function Native116RecoveryPanel(){
 const user=useAuthStore(s=>s.user),token=useAuthStore(s=>s.token),epoch=useRef(0);
 const [items,setItems]=useState<Item[]>([]),[preview,setPreview]=useState<Preview|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{epoch.current++;setItems([]);setPreview(null);setReason('');setBusy(false);setNotice('');},[token]);
 if(!user||(user.role!=='ADMIN'&&!user.roles?.includes('ADMIN')))return null;
 async function load(){const g=++epoch.current;setBusy(true);setPreview(null);setNotice('');
  try{const r=await req<{items:Item[]}>('/native-documents/native116/queue');if(g===epoch.current)setItems(r.items);}
  catch(e){if(g===epoch.current)setNotice(message(e));}finally{if(g===epoch.current)setBusy(false);}}
 async function inspect(stageId:string){const g=++epoch.current;setBusy(true);setPreview(null);setNotice('');
  try{const p=await req<Preview>('/native-documents/native116/inspect',{method:'POST',body:JSON.stringify({stageId})});if(g===epoch.current)setPreview(p);}
  catch(e){if(g===epoch.current)setNotice(message(e));}finally{if(g===epoch.current)setBusy(false);}}
 async function restore(){if(!preview)return;const g=++epoch.current;setBusy(true);setNotice('');
  try{await req('/native-documents/native116/restore',{method:'POST',body:JSON.stringify({stageId:preview.stageId,fingerprint:preview.fingerprint,reason})});
   if(g===epoch.current){setItems(v=>v.filter(i=>i.stageId!==preview.stageId));setPreview(null);setNotice('คืนเอกสารและยอดตั๋วสู่สภาพก่อนเริ่มรายการ พร้อมบันทึกประวัติแล้ว กรุณาเปิด WinSpeed และทำรายการใหม่');}}
  catch(e){if(g===epoch.current){setNotice(message(e));setPreview(null);}}finally{if(g===epoch.current)setBusy(false);}}
 return <section className="mt-3 rounded border border-amber-300 bg-white p-4 text-sm" aria-label="กู้รายการ WinSpeed ค้าง">
  <h3 className="font-bold">รายการ WinSpeed บันทึกไม่ครบ</h3>
  <p>ปิด WinSpeed ที่ทำรายการค้างก่อนกู้ ตรวจภาพล่าสุดแล้วยืนยันคืนสภาพก่อนเริ่มรายการ ยอดตั๋วยังพักจนกู้สำเร็จ</p>
  <button type="button" disabled={busy} onClick={()=>void load()} className="mt-2 rounded border p-2">ตรวจรายการค้าง WinSpeed</button>
  {items.map(i=><div key={i.stageId} className="mt-2 rounded border p-2"><p>{i.docuNo?`ใบขน ${i.docuNo}`:'ค้างก่อนระบุใบขน'} · {i.connectionOpen?'WinSpeed ยังเชื่อมต่อ':'พร้อมตรวจการกู้'}</p><DocumentDate date={i.docuDate}/>
   <button type="button" disabled={busy} onClick={()=>void inspect(i.stageId)} className="mt-2 rounded border p-2">ตรวจภาพล่าสุดก่อนกู้</button></div>)}
  {preview&&<div className="mt-3 rounded border border-amber-400 p-3"><p>{preview.restoreExisting?'คืนเอกสารเดิมก่อนแก้ไข':'นำเอกสารที่ยังบันทึกไม่ครบออก'} และคืนยอดก่อนเริ่มรายการ</p>
   {preview.coupons.map(c=><p key={c.couponId}>{c.couponNo} · ยอดปัจจุบัน {c.currentBalance} → คืนเป็น {c.restoreBalance} ตัน</p>)}
   {preview.connectionOpen&&<p role="alert">กรุณาปิด WinSpeed ที่ทำรายการค้าง แล้วตรวจภาพล่าสุดอีกครั้ง</p>}
   <label className="mt-2 block">เหตุผลกู้รายการ<textarea aria-label="เหตุผลกู้รายการ WinSpeed" value={reason} disabled={busy} maxLength={500} onChange={e=>setReason(e.target.value)} className="block w-full rounded border p-2"/></label>
   <button type="button" disabled={busy||preview.connectionOpen||reason.trim().length<10} onClick={()=>void restore()} className="mt-2 rounded bg-amber-700 p-2 text-white disabled:opacity-50">ยืนยันคืนสภาพก่อนเริ่มรายการ</button></div>}
  {notice&&<p role="status" className="mt-2">{notice}</p>}
 </section>;
}
