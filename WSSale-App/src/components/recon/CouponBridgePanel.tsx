import {useEffect, useRef, useState} from 'react';
import {req} from '../../services/api';
import {useCan, useFeature} from '../../utils/capabilities';
import {useAuthStore} from '../../store/auth-store';
import {Native116RecoveryPanel} from './Native116RecoveryPanel';
import {native116ErrorMessage} from '../../utils/native116Errors';
type Line={couponId:number;couponNo?:string;before:string;after:string;nativeBefore:string};
type Preview={fingerprint:string;registered:boolean;opening:boolean;plan:{lines:Line[]};data?:{docDate:string;receiver:string;plate:string}};
type Item={PermitId:string;CustId:number;DocuNo:string|null;State:string;Operation:string;opening:boolean};
const send=<T,>(operation:string,body:object)=>req<T>('/native-documents/bridge/'+operation,{method:'POST',body:JSON.stringify(body)});
const errorText=(e:unknown)=>{const code=(e as {data?:{code?:string}}).data?.code||'';
 return native116ErrorMessage(code)||`ยังดำเนินการไม่ได้ กรุณาตรวจสิทธิ์ ข้อมูลล่าสุด และยอดพัก (${code||'กรุณาลองใหม่'})`;};
export function NativeBridgeCreate({requestId,reason,onDone}:{requestId:string;reason:string;onDone:()=>void}){
 const feature=useFeature(),can=useCan(),token=useAuthStore(s=>s.token),epoch=useRef(0);
 const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{epoch.current++;setPreview(null);setNotice('');setBusy(false);},[token,requestId,reason]);
 if(!feature('native-coupon-bridge')||!can('coupon.manual116'))return null;
 async function act(){const generation=++epoch.current;setBusy(true);setNotice('');
  try{const body={operationType:'C',requestId,reason};
   if(!preview){const p=await send<Preview>('inspect',body);if(generation===epoch.current)setPreview(p);}
   else {await send('publish',{...body,fingerprint:preview.fingerprint});if(generation===epoch.current){setPreview(null);setNotice('อนุมัติให้บันทึกใน WinSpeed ตามคำขอนี้ภายใน 15 นาทีแล้ว');onDone();}}
  }catch(e){if(generation===epoch.current){setNotice(errorText(e));setPreview(null);}}
  finally{if(generation===epoch.current)setBusy(false);}
 }
 return <div className="mt-2 rounded border border-amber-200 p-2">
  {preview&&<p>ตรวจแล้ว {preview.plan.lines.length} บรรทัด · เมื่อยืนยันให้บันทึกใบขนใน WinSpeed ตามจำนวนที่อนุมัติ</p>}
  <button type="button" disabled={busy||reason.trim().length<10} onClick={()=>void act()} className="rounded border px-3 py-2 disabled:opacity-50">
   {preview?'ยืนยันใบอนุญาตสำหรับ WinSpeed':'เตรียมบันทึกผ่าน WinSpeed'}</button>
  {notice&&<p role="status">{notice}</p>}
 </div>;
}
export function CouponBridgeEdit({custId,coupons,onDone}:{custId:number;coupons:{id:number;couponNo:string}[];onDone:()=>void}){
 const feature=useFeature(),can=useCan(),token=useAuthStore(s=>s.token),epoch=useRef(0);
 const [number,setNumber]=useState(''),[operation,setOperation]=useState<'E'|'D'>('E'),[reason,setReason]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null),[wanted,setWanted]=useState<Record<number,string>>({});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[newCoupon,setNewCoupon]=useState('');
 useEffect(()=>{epoch.current++;setPreview(null);setWanted({});setNumber('');setReason('');setNotice('');setBusy(false);},[token,custId]);
 if(!feature('native-coupon-bridge')||!can('coupon.settle'))return null;
 const invalidate=()=>{epoch.current++;setPreview(null);setNotice('');};
 async function act(action:'inspect'|'adopt'|'publish'){
  const generation=++epoch.current;setBusy(true);setNotice('');
  try{
   const body={docuNo:number.trim(),custId,operationType:operation,reason:reason.trim(),
    lines:operation==='D'?[]:Object.keys(wanted).length?Object.entries(wanted).map(([couponId,quantity])=>({couponId:Number(couponId),quantity})):undefined};
   if(action==='inspect'){
    const p=await send<Preview>(action,body);if(generation===epoch.current){setPreview(p);if(!Object.keys(wanted).length)setWanted(Object.fromEntries(p.plan.lines.map(l=>[l.couponId,l.after])));}
   }else{
    await send(action,{...body,fingerprint:preview?.fingerprint});
    if(generation===epoch.current){setPreview(null);setNotice(action==='adopt'?'ตรวจรับหลักฐานปัจจุบันแล้ว กรุณาตรวจแผนอีกครั้งก่อนอนุมัติ':'อนุมัติแผนแล้ว ให้ทำรายการใน WinSpeed ภายใน 15 นาที แล้วตรวจผลในคิว');onDone();}
   }
  }catch(e){if(generation===epoch.current){setNotice(errorText(e));setPreview(null);}}
  finally{if(generation===epoch.current)setBusy(false);}
 }
 return <section className="mt-3 space-y-2 rounded border border-amber-300 p-3 text-sm">
  <h3 className="font-bold">แก้ไขหรือยกเลิกใบขนใน WinSpeed</h3>
  <label className="block">เลขใบขน <input disabled={busy} value={number} maxLength={25} onChange={e=>{setNumber(e.target.value);setWanted({});invalidate();}} className="rounded border p-2"/></label>
  <select aria-label="แผนใบขน WinSpeed" value={operation} disabled={busy} onChange={e=>{setOperation(e.target.value as 'E'|'D');invalidate();}} className="rounded border p-2">
   <option value="E">แก้ไขจำนวน / เพิ่มหรือลบบรรทัด</option><option value="D">ยกเลิกทั้งใบ</option></select>
  {operation==='E'&&Object.entries(wanted).map(([cid,quantity])=><label className="block" key={cid}>
   {preview?.plan.lines.find(l=>l.couponId===Number(cid))?.couponNo||coupons.find(c=>c.id===Number(cid))?.couponNo||`ตั๋ว #${cid}`} · จำนวนใหม่ (ตัน)
   <input disabled={busy} value={quantity} inputMode="decimal" onChange={e=>{setWanted({...wanted,[cid]:e.target.value});invalidate();}} className="ml-2 w-28 rounded border p-2"/>
  </label>)}
  {operation==='E'&&<div><select disabled={busy} aria-label="เพิ่มตั๋วในใบขน" value={newCoupon} onChange={e=>setNewCoupon(e.target.value)} className="rounded border p-2">
   <option value="">เลือกตั๋วเพิ่ม</option>{coupons.filter(c=>wanted[c.id]===undefined).map(c=><option key={c.id} value={c.id}>{c.couponNo}</option>)}
  </select><button disabled={busy||!newCoupon} type="button" onClick={()=>{setWanted({...wanted,[newCoupon]:'0.0000'});setNewCoupon('');invalidate();}} className="ml-2 rounded border p-2">เพิ่มบรรทัด</button></div>}
  <p>ระบุ 0 เพื่อนำบรรทัดออก ยอดคืนจะกลับไปยังรายการจองเดิมหลังตรวจปล่อยยอด</p>
  <textarea aria-label="เหตุผลแผน WinSpeed" value={reason} disabled={busy} maxLength={500} onChange={e=>{setReason(e.target.value);invalidate();}} className="w-full rounded border p-2" placeholder="เหตุผลอย่างน้อย 10 ตัวอักษร"/>
  <button type="button" disabled={busy||!number.trim()} onClick={()=>void act('inspect')} className="rounded border p-2">ตรวจแผนล่าสุด</button>
  {preview&&<><p>{preview.opening?'ต้นทางยกมา · ซ่อนรายละเอียดเอกสารเดิม':'ตรวจข้อมูลต้นทางแล้ว'} · {preview.plan.lines.length} บรรทัด</p>
   {preview.plan.lines.map(l=><p key={l.couponId}>{l.couponNo||'ตั๋ว'} · {l.before} → {l.after} ตัน</p>)}
   <button type="button" disabled={busy||reason.trim().length<10} onClick={()=>void act(preview.registered?'publish':'adopt')} className="rounded bg-blue-800 p-2 text-white disabled:opacity-50">
    {preview.registered?'อนุมัติแผนสำหรับ WinSpeed':'ตรวจรับหลักฐานเอกสารเดิม'}</button></>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
export function CouponBridgeQueue(){
 const feature=useFeature(),can=useCan(),token=useAuthStore(s=>s.token),epoch=useRef(0);
 const [items,setItems]=useState<Item[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[reason,setReason]=useState('');
 const [review,setReview]=useState<{permitId:string;operation:string;fingerprint:string;lines:{couponNo:string;beforeQty:string;afterQty:string}[]}|null>(null);
 useEffect(()=>{epoch.current++;setItems([]);setReview(null);setBusy(false);setNotice('');setReason('');},[token]);
 if(!feature('native-coupon-bridge')||!can('coupon.settle'))return null;
 async function load(){const generation=++epoch.current;setBusy(true);setNotice('');setReview(null);
  try{const r=await req<{items:Item[]}>('/native-documents/bridge/queue');if(generation===epoch.current)setItems(r.items);}
  catch(e){if(generation===epoch.current)setNotice(errorText(e));}finally{if(generation===epoch.current)setBusy(false);}}
 async function act(permitId:string,operation:string){const generation=++epoch.current;setBusy(true);setNotice('');
  try{const r=await send<{reviewRequired?:boolean;fingerprint:string;lines:{couponNo:string;beforeQty:string;afterQty:string}[]}>(operation,{permitId,reason,
   fingerprint:review?.permitId===permitId&&review.operation===operation?review.fingerprint:undefined});
   if(generation===epoch.current){if(r.reviewRequired)setReview({permitId,operation,fingerprint:r.fingerprint,lines:r.lines});
    else{setReview(null);setNotice('ดำเนินการแล้ว กรุณาโหลดคิวและตรวจยอดอีกครั้ง');}}}
  catch(e){if(generation===epoch.current){setNotice(errorText(e));setReview(null);}}finally{if(generation===epoch.current)setBusy(false);}}
 return <section className="rounded border border-amber-200 bg-white p-4 text-sm">
  <h3 className="font-bold">ใบอนุญาต WinSpeed และคิวคืนยอด</h3>
  <button type="button" disabled={busy} onClick={()=>void load()} className="mt-2 rounded border p-2">โหลดคิวล่าสุด</button>
  <textarea aria-label="เหตุผลตรวจใบอนุญาต" value={reason} disabled={busy} maxLength={500} onChange={e=>{setReason(e.target.value);setReview(null);}} className="mt-2 w-full rounded border p-2" placeholder="เหตุผลตรวจ / กู้ / ปล่อยยอด อย่างน้อย 10 ตัวอักษร"/>
  {items.map(item=><div key={item.PermitId} className="mt-2 rounded border p-3">
   <p>{item.DocuNo?`ใบขน ${item.DocuNo}`:'ต้นทางยกมา'} · {item.State==='STARTED'?'บันทึกไม่ครบ — ยอดยังพัก':item.State==='COMPLETE'?'คืนยอดแล้ว — รอตรวจปล่อย':'รอบันทึก WinSpeed'}</p>
   {[item.State==='APPROVED'?'withdraw':item.State==='STARTED'?'recover':'release'].map(operation=><button key={operation} type="button" disabled={busy||reason.trim().length<10}
    onClick={()=>void act(item.PermitId,operation)} className="mt-2 rounded border p-2 disabled:opacity-50">
    {review?.permitId===item.PermitId&&review.operation===operation?'ยืนยันตามหลักฐานล่าสุด':operation==='withdraw'?'ตรวจถอนใบอนุญาต':operation==='recover'?'ตรวจแผนกู้ใบขน':'ตรวจปล่อยยอดพัก'}</button>)}
   {review?.permitId===item.PermitId&&<><p>ตรวจหลักฐานล่าสุดแล้ว กรุณายืนยันอีกครั้งเพื่อดำเนินการ ยอดจะยังพักหากพิสูจน์ไม่ครบ</p>
    {review.lines.map(l=><p key={l.couponNo}>{l.couponNo} · {l.beforeQty} → {l.afterQty} ตัน</p>)}</>}
  </div>)}
  {notice&&<p role="status" className="mt-2">{notice}</p>}
  <Native116RecoveryPanel/>
 </section>;
}
