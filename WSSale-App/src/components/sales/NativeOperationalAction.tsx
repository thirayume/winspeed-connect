import {useState} from 'react';
import {createPortal} from 'react-dom';
import {req} from '../../services/api';
import {useCan} from '../../utils/capabilities';
import {DOC_TYPES} from '../../utils/docTypes';
import {NativeDocPrint} from '../reports/NativeDocPrint';
import {NativeCreditSummary} from './NativeCreditSummary';
import type {CustomerCreditStatus} from '../../types';

type Stage=119|104|116|107;
type Cut={redemptionId:number;redemptionNo:string;lineNo:number;deliveryId:number;couponNo:string;quantity:string;docDate:string};
type Pending={requestId:string;docuType:number;sourceId:number;status:string;expiresAt:string;reason:string;isRequester:boolean;canApprove:boolean;slipNo?:string;receiver?:string;plate?:string;quantity?:string;lines:{couponId:number;couponNo?:string;quantity:string}[]};
type Context={soid:number;docuNo:string;custId:number;approvalNo:string|null;today:string;credit:CustomerCreditStatus|null;
 gross:string;discount:string;tax:string;amount:string;orderLines:{lineNo:number;goodName:string;quantity:string;price:string;amount:string}[];
 deliveries:{id:number;docNo:string}[];coupons:{id:number;couponNo:string;goodName:string;remaining:string;available:string;reservations:{id:string;carrierNo:string|null;remaining:string}[]}[];
 moreCoupons:boolean;requests:Pending[];cuts:Cut[];permissions:Record<string,boolean>};
type PlanLine={couponId?:number;couponNo?:string;quantity:string;expired?:boolean;expiryDate?:string;goodId?:number;gross?:string;discount?:string};
type Preview={fingerprint:string;sourceId:number;plan:{lines:PlanLine[];gross?:string;discount?:string;tax?:string;net?:string}};
type Receipt={nativeNo:string;nativeId:number;docuType:Stage;replayed:boolean;lines:{CouponNo?:string}[]};
type Command={sourceId:number;requestId:string;fingerprint?:string;reason:string;lines:unknown[];data:Record<string,string>};
const permission:Record<Stage,string>={119:'so.approve-native',104:'so.create-native-delivery',116:'coupon.request116',107:'invoice.post-native'};
const title=(type:Stage)=>type===119?DOC_TYPES.AI.name:`${DOC_TYPES[String(type)].name} (${type})`;
const describe=(e:unknown)=>{
 const code=(e as {data?:{code?:string}}).data?.code||'';
 const messages:Record<string,string>={
  ND_SOURCE_CHANGED:'เอกสาร ยอดจอง หรือข้อมูลเครดิตเปลี่ยน กรุณาตรวจและยื่นคำขอใหม่',
  ND_PREVIEW_STALE:'ข้อมูลเปลี่ยน กรุณาตรวจใหม่ก่อนยืนยัน',ND_COUPON_INSUFFICIENT:'ยอดตั๋วพร้อมใช้ไม่พอ กรุณาตรวจยอดจองและยอดขน',
  ND_REQUEST_EXPIRED:'คำขอหมดอายุ กรุณายื่นใหม่',ND_APPROVAL_REQUIRED:'ต้องได้รับอนุมัติก่อนบันทึก',
  ND_ACTOR_FORBIDDEN:'ไม่มีสิทธิ์ทำรายการนี้',ND_SELF_APPROVAL:'ผู้ขายอนุมัติใบจองตนเองไม่ได้',
  ND_APPROVER_NOT_LISTED:'กรุณาให้ผู้ดูแลผูกพนักงานและรายชื่อผู้อนุมัติ WinSpeed',
  ND_ORIGIN_CHANGED:'ใบจองเปลี่ยนจากตอนยืนยัน กรุณาตรวจหลักฐานก่อนดำเนินการ',
  ND_VAT_APPROVAL_REQUIRED:'ฝ่ายบัญชียังไม่ยืนยันข้อมูล VAT ที่ใช้กับเอกสารนี้',
  ND_COST_SCOPE_UNREVIEWED:'มีรายการต้นทุนที่ต้องตรวจสอบก่อน Post Invoice กรุณาติดต่อฝ่ายบัญชี',
  ND_RECEIPT_DIVERGED:'เอกสารปลายทางเปลี่ยน กรุณาตรวจหลักฐานก่อนทำต่อ',
  ND_SLIP_INVALID_OR_USED:'เลขใบขนใช้แล้ว หรือข้อมูลใบขนไม่ครบ กรุณาตรวจรายการเดิมก่อนบันทึกซ้ำ',
  ND_TARGET_NOT_READY:'ตัวเขียนเอกสารยังไม่ผ่านการตั้งค่าและตรวจรับในระบบนี้',
  ND_CUSTOMER_CREDIT_HOLD:'ลูกค้าถูกระงับเครดิต กรุณาให้ฝ่ายการเงินปลดระงับก่อนออกใบสั่งขาย',
 };
 return messages[code]||`ดำเนินการไม่สำเร็จ (${code||'กรุณาลองใหม่'})`;
};
export function NativeOperationalAction({soid,stage,onCreated}:{soid:string|number;stage:Stage;onCreated:()=>void}){
 const can=useCan(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [context,setContext]=useState<Context|null>(null),[preview,setPreview]=useState<Preview|null>(null),[command,setCommand]=useState<Command|null>(null);
 const [receipt,setReceipt]=useState<Receipt|null>(null),[reason,setReason]=useState(''),[quantities,setQuantities]=useState<Record<number,string>>({});
 const [settlements,setSettlements]=useState<Record<string,string>>({});
 const [slipNo,setSlipNo]=useState(''),[receiver,setReceiver]=useState(''),[plate,setPlate]=useState(''),[docDate,setDocDate]=useState('');
 const [invoiceGroup,setInvoiceGroup]=useState(''),[printing,setPrinting]=useState(false);
 const [couponSearch,setCouponSearch]=useState('');
 if(!can(permission[stage])&&!(stage===116&&can('coupon.manual116')))return null;
 async function load(search=''){
  const c=await req<Context>(`/native-documents/booking/${soid}${search?'?couponNo='+encodeURIComponent(search):''}`);
  setContext(old=>search&&old?{...c,coupons:[...old.coupons.filter(p=>!c.coupons.some(n=>n.id===p.id)),...c.coupons]}:c);
  setDocDate(old=>old||c.today);return c;
 }
 async function findCoupon(){
  if(busy||!couponSearch.trim())return;setBusy(true);setError('');setPreview(null);
  try{const c=await load(couponSearch.trim());if(!c.coupons.length)setError('ไม่พบตั๋วคงเหลือในขอบเขตลูกค้ารายนี้');}
  catch(e){setError(describe(e));}finally{setBusy(false);}
 }
 async function inspect(){
  setOpen(true);setBusy(true);setError('');
  try{await load();}catch(e){setError(describe(e));}finally{setBusy(false);}
 }
 async function send(operation:string,c:Command){
  return req<Receipt&Pending>(`/native-documents/${stage}/${c.sourceId}/${operation}`,{method:'POST',body:JSON.stringify(c)});
 }
 async function prepare(){
  if(!context||busy)return;setBusy(true);setError('');setPreview(null);setReceipt(null);
  try{
   const lines=stage===116?context.coupons.filter(c=>Number(quantities[c.id])>0).map(c=>({couponId:c.id,quantity:quantities[c.id],
    settlements:c.reservations.filter(r=>Number(settlements[r.id])>0).map(r=>({reservationId:r.id,quantity:settlements[r.id]}))}))
    :stage===107?context.cuts.filter(c=>`${c.deliveryId}:${c.docDate}`===invoiceGroup).map(c=>({redemptionId:c.redemptionId,lineNo:c.lineNo})):[];
   const sourceId=stage===116?context.custId:stage===107?Number(invoiceGroup.split(':')[0]):Number(soid);
   const data:Record<string,string>=stage===116?{docDate,slipNo,receiver,plate}:stage===107?{docDate:invoiceGroup.split(':')[1]}:{};
   const c:Command={sourceId,lines,data,requestId:crypto.randomUUID(),reason:reason.trim()};
   const p=await req<Preview>(`/native-documents/${stage}/${sourceId}/preview`,{method:'POST',body:JSON.stringify(c)});
   setCommand({...c,fingerprint:p.fingerprint});setPreview(p);
  }catch(e){setError(describe(e));}finally{setBusy(false);}
 }
 async function commit(){
  if(!command||!preview||busy)return;setBusy(true);setError('');
  try{
   const result=await send(stage===104||stage===116?'request':'apply',command);
   if(stage===119||stage===107)setReceipt(result);
   setPreview(null);await load();onCreated();
  }catch(e){setError(describe(e));}finally{setBusy(false);}
 }
 async function decision(r:Pending,operation:'approve'|'reject'|'cancel'|'apply'){
  if(busy)return;setBusy(true);setError('');
  try{
   const c:Command={sourceId:r.sourceId,requestId:r.requestId,reason:reason.trim(),lines:[],data:{}};
   const result=await send(operation,c);
   if(operation==='apply')setReceipt(result);
   await load();onCreated();
  }catch(e){setError(describe(e));}finally{setBusy(false);}
 }
 const pending=context?.requests.filter(r=>r.docuType===stage)||[];
 const groups=[...new Set(context?.cuts.map(c=>`${c.deliveryId}:${c.docDate}`)||[])];
 const ready=stage===119?!context?.approvalNo:stage===104?!context?.deliveries.length:true;
 const action=stage===119?'อนุมัติใบจอง':stage===104?'ออกใบสั่งขาย (104)':stage===116?'ขอตัดตั๋ว / บันทึกใบขน (116)':'Post Invoice (107)';
 return <>
  <button onClick={inspect} disabled={busy} className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900">{action}</button>
  {open&&createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={action}>
   <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
    <h2 className="text-lg font-bold text-[#0C447C]">{title(stage)}</h2>
    {context&&<div className="mt-3 space-y-3 text-sm">
     <p>ใบสั่งจอง {context.docuNo}{context.approvalNo&&` · ${context.approvalNo}`}</p>
     {context.deliveries.map(d=><p key={d.id}>ใบสั่งขาย {d.docNo}</p>)}
     {stage===116&&<>
      <p>เลือกหลายตั๋ว C/D ของลูกค้ารายนี้ได้ และระบุจำนวนที่จะขนในรอบนี้ ยอดจองอื่นยังถูกกันไว้</p>
      <div className="flex gap-2"><input aria-label="เลขตั๋วที่ต้องการค้นหา" value={couponSearch} onChange={e=>setCouponSearch(e.target.value)}
       maxLength={25} placeholder="ค้นหาเลขตั๋วตรงตัว รวมตั๋วยกมา" className="min-w-0 flex-1 rounded border p-2"/>
       <button disabled={busy||!couponSearch.trim()} onClick={findCoupon} className="rounded border px-3 py-2">เพิ่มตั๋วจากการค้นหา</button></div>
      <div className="max-h-56 overflow-y-auto"><table className="w-full"><thead><tr><th className="text-left">ตั๋ว / สินค้า</th><th>พร้อมใช้ (ตัน)</th><th>ขนครั้งนี้ (ตัน)</th></tr></thead><tbody>
       {context.coupons.map(c=><tr key={c.id} className="border-t"><td className="py-2">{c.couponNo}<small className="block text-gray-500">{c.goodName}</small>
        {c.reservations.map(r=><label key={r.id} className="mt-2 block text-xs">ใช้ยอดจอง {r.carrierNo||'ยกมา'} (เหลือ {r.remaining} ตัน)
         <input aria-label={`ใช้ยอดจอง ${r.id}`} type="number" min="0" max={r.remaining} step="0.0001" value={settlements[r.id]||''} disabled={busy}
          onChange={e=>{setSettlements({...settlements,[r.id]:e.target.value});setPreview(null);}} className="ml-2 w-24 rounded border p-1"/></label>)}
        </td><td className="text-right">{c.available}<small className="block text-gray-500">คงเหลือ {c.remaining}</small></td><td className="pl-3"><input aria-label={`จำนวน ${c.couponNo}`} type="number" min="0" max={c.remaining} step="0.0001" value={quantities[c.id]||''} disabled={busy} onChange={e=>{setQuantities({...quantities,[c.id]:e.target.value});setPreview(null);}} className="w-28 rounded border p-2"/></td></tr>)}
      </tbody></table></div>
      {context.moreCoupons&&<p>เริ่มแสดงตั๋วล่าสุด 100 ใบ สามารถค้นหาเลขตั๋วเพิ่มเติมเพื่อเลือกในใบขนเดียวกันได้</p>}
      <div className="grid grid-cols-2 gap-2">
       <label>เลขใบขน<input value={slipNo} onChange={e=>{setSlipNo(e.target.value);setPreview(null);}} maxLength={25} className="w-full rounded border p-2"/></label>
       <label>วันที่ขน<input type="date" max={context.today} value={docDate} onChange={e=>{setDocDate(e.target.value);setPreview(null);}} className="w-full rounded border p-2"/></label>
       <label>ผู้รับ<input value={receiver} onChange={e=>{setReceiver(e.target.value);setPreview(null);}} maxLength={100} className="w-full rounded border p-2"/></label>
       <label>ทะเบียนรถ<input value={plate} onChange={e=>{setPlate(e.target.value);setPreview(null);}} maxLength={25} className="w-full rounded border p-2"/></label>
      </div><p className="rounded bg-amber-50 p-2">ใบขนที่ระบุเองต้องให้ผู้จัดการ ผู้บริหาร หรือ ADMIN ตรวจหลักฐานก่อน ผู้บันทึกต้องผูกพนักงาน WinSpeed</p>
     </>}
     {stage===107&&<>
      <p>ออกแยกตามใบสั่งขายและวันที่ขน ยอดลูกหนี้อยู่ใน 202 แล้ว ส่วน VAT/GL ให้บัญชีทำต่อใน WinSpeed</p>
      <select aria-label="ชุดใบขนสำหรับ Post Invoice" value={invoiceGroup} onChange={e=>{setInvoiceGroup(e.target.value);setPreview(null);}} className="w-full rounded border p-2">
       <option value="">เลือกชุดใบขน</option>{groups.map(g=><option key={g} value={g}>{context.deliveries.find(d=>d.id===Number(g.split(':')[0]))?.docNo} · {g.split(':')[1]}</option>)}
      </select>
      {context.cuts.filter(c=>`${c.deliveryId}:${c.docDate}`===invoiceGroup).map(c=><p key={`${c.redemptionId}:${c.lineNo}`}>ใบขน {c.redemptionNo} · {c.couponNo} · {c.quantity} ตัน</p>)}
      {!groups.length&&<p>ไม่มีใบขนที่รอ Post Invoice</p>}
     </>}
     {stage===104&&<><p>ออกตั๋วครบทุกบรรทัดและตั้งยอดสุทธิใน 202 พร้อมกัน ต้องให้บัญชีตรวจเครดิตก่อนออกเอกสาร</p>
      <NativeCreditSummary credit={context.credit}/>
      {context.orderLines.map(l=><p key={l.lineNo}>{l.goodName} · {l.quantity} ตัน × {l.price} บาท/ตัน</p>)}
      <p className="font-bold">สินค้า {context.gross} · ส่วนลด {context.discount} · ภาษี {context.tax} · สุทธิ {context.amount} บาท</p>
     </>}
     {pending.map(r=><div key={r.requestId} className="rounded border bg-gray-50 p-3">
      <p>{r.status==='PENDING'?'รออนุมัติ':'อนุมัติแล้ว'}{r.slipNo&&` · ใบขน ${r.slipNo} · ${r.quantity} ตัน`}</p>
      <p>เหตุผลคำขอ: {r.reason}</p>
      {r.receiver&&<p>{r.receiver} · {r.plate}</p>}
      {stage===116&&r.lines.map(l=><p key={l.couponId}>{l.couponNo||context.coupons.find(c=>c.id===l.couponId)?.couponNo} · {l.quantity} ตัน</p>)}
      <div className="mt-2 flex flex-wrap gap-2">
       {r.status==='PENDING'&&r.canApprove&&<><button disabled={busy||reason.trim().length<5} onClick={()=>decision(r,'approve')} className="rounded bg-emerald-700 px-3 py-2 text-white">อนุมัติ</button><button disabled={busy||reason.trim().length<5} onClick={()=>decision(r,'reject')} className="rounded border px-3 py-2">ไม่อนุมัติ</button></>}
       {r.isRequester&&<button disabled={busy||reason.trim().length<5} onClick={()=>decision(r,'cancel')} className="rounded border px-3 py-2">ยกเลิกคำขอ</button>}
       {r.status==='APPROVED'&&((stage===104&&r.isRequester)||(stage===116&&context.permissions['coupon.manual116']))&&<button disabled={busy} onClick={()=>decision(r,'apply')} className="rounded bg-blue-800 px-3 py-2 text-white">ยืนยันบันทึก</button>}
      </div>
     </div>)}
     <label className="block">เหตุผลการทำรายการ / พิจารณา<textarea value={reason} onChange={e=>{setReason(e.target.value);setPreview(null);}} maxLength={500} className="mt-1 w-full rounded border p-2"/></label>
     {preview&&<div className="rounded bg-blue-50 p-3">
      <p className="font-bold">ตรวจข้อมูลก่อนยืนยัน · {preview.plan.lines.length} บรรทัด</p>
      {preview.plan.lines.map((l,i)=><p key={i}>{l.couponNo||`บรรทัด ${i+1}`} · {l.quantity} ตัน{l.expired&&<strong className="ml-2 text-amber-800">หมดอายุ {l.expiryDate} — ใช้ได้และบันทึกเหตุการณ์</strong>}</p>)}
      {preview.plan.net!==undefined&&<p>สินค้า {preview.plan.gross} · ส่วนลด {preview.plan.discount} · ภาษี {preview.plan.tax} · สุทธิ {preview.plan.net} บาท</p>}
      <button disabled={busy||reason.trim().length<5} onClick={commit} className="mt-2 rounded bg-blue-800 px-3 py-2 text-white">{stage===104||stage===116?'ยื่นขออนุมัติ':'ยืนยันบันทึกเอกสาร'}</button>
     </div>}
     {receipt&&<div role="status" className="rounded bg-emerald-50 p-3">บันทึกแล้ว: <strong>{receipt.nativeNo}</strong>{receipt.replayed&&' (รายการเดิม)'}
      {receipt.lines.filter(l=>l.CouponNo).map((l,i)=><p key={i}>ตั๋ว {l.CouponNo}</p>)}
      {stage!==119&&can(`native.print-${stage}`)&&<button onClick={()=>setPrinting(true)} className="mt-2 rounded border px-3 py-2">พิมพ์เอกสาร</button>}
     </div>}
    </div>}
    {error&&<p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex justify-end gap-2 text-sm">
     <button disabled={busy} onClick={()=>setOpen(false)} className="rounded border px-3 py-2">ปิด</button>
     <button disabled={busy} onClick={inspect} className="rounded border px-3 py-2">ตรวจสถานะ</button>
     {context&&ready&&<button disabled={busy||reason.trim().length<5||(stage===107&&!invoiceGroup)} onClick={prepare} className="rounded bg-blue-800 px-3 py-2 text-white">ตรวจข้อมูลก่อนยืนยัน</button>}
    </div>
   </div>
  </div>,document.body)}
  {printing&&receipt&&stage!==119&&<NativeDocPrint type={stage} docuNo={receipt.nativeNo} onClose={()=>setPrinting(false)}/>}
 </>;
}
