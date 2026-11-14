import { useCallback, useEffect, useState } from 'react';
import { decideRebateConversionRequest, fetchRebateConversionRequests, submitRebateConversionRequest,
  type RebateConversionRequestItem } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { useCan } from '../../utils/capabilities';
import { appAlert, appConfirm, appPrompt } from '../ui/AppAlert';
import { SearchableSelect, type SearchableSelectOption } from '../ui/SearchableSelect';

const labels:Record<string,string> = { PENDING:'รออนุมัติ', APPROVED:'อนุมัติแล้ว', REJECTED:'ไม่อนุมัติ', CANCELLED:'ยกเลิก' };
export function RebateConversionRequests({ customers, goods }: { customers:SearchableSelectOption[]; goods:SearchableSelectOption[] }) {
  const user = useAuthStore(s => s.user); const can = useCan();
  const canRequest = can('rebate.conversion.request'), canApprove = can('rebate.conversion.approve');
  const [items,setItems] = useState<RebateConversionRequestItem[]|null>(null);
  const [database,setDatabase] = useState('');
  const [unavailable,setUnavailable] = useState(false), [busy,setBusy] = useState(false);
  const [custId,setCustId] = useState(''), [goodId,setGoodId] = useState('');
  const [year,setYear] = useState(String(new Date().getFullYear())), [tons,setTons] = useState('');
  const [all,setAll] = useState(false), [note,setNote] = useState(''), [expiryDate,setExpiryDate] = useState('');
  const refresh = useCallback(async () => {
    try { const result=await fetchRebateConversionRequests(); setItems(result.items);setDatabase(result.database);setUnavailable(false); }
    catch { setItems(null);setDatabase('');setUnavailable(true); }
  },[]);
  useEffect(()=>{ if(canRequest || canApprove) void refresh(); },[canRequest,canApprove,refresh]);
  if(!canRequest && !canApprove) return null;
  const submit = async () => {
    const quantity=Number(tons), standingYear=Number(year);
    if(!custId || !goodId || !Number.isInteger(standingYear) || standingYear<2000 || standingYear>2100 ||
      !note.trim() || (!all && (!Number.isFinite(quantity) || quantity<=0))) {
      await appAlert('กรุณาเลือกลูกค้า สินค้า ปีราคา จำนวน และระบุหมายเหตุให้ครบ','warning'); return;
    }
    if(!await appConfirm('ยื่นคำขอแปลง Rebate และจองยอดระหว่างรออนุมัติใช่หรือไม่?')) return;
    setBusy(true);
    try {
      if(!database) throw new Error('ไม่สามารถยืนยันฐานข้อมูลปัจจุบัน');
      const payload={custId:Number(custId),goodId:Number(goodId),standingYear,note:note.trim(),
        ...(all?{convertAllEligible:true}:{requestedTons:quantity}),...(expiryDate?{expiryDate}:{})};
      // Persist only a hash and random request ID, scoped to the real/effective
      // identities and database. A lost response retries the same reservation.
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({database,actor:user?.actorId||user?.id,effective:user?.id,payload})));
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      const key=`wf-rebate-approval:${hash}`;
      let requestId=sessionStorage.getItem(key);
      if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
      const result=await submitRebateConversionRequest({...payload,requestId,expectedDatabase:database});
      sessionStorage.removeItem(key);setNote('');setTons('');setExpiryDate('');
      await appAlert(`ยื่นคำขอ #${result.id} แล้ว ยอดถูกจองระหว่างรออนุมัติ`,'info');await refresh();
    } catch(e:unknown) { await appAlert((e as Error).message||'ยื่นคำขอไม่สำเร็จ','error'); }
    finally {setBusy(false);}
  };
  const decide=async(row:RebateConversionRequestItem,action:'approve'|'reject'|'cancel')=>{
    const reason=await appPrompt('ระบุเหตุผลหรือหมายเหตุสำหรับการตัดสินใจ (จำเป็น)');
    if(reason===null)return;
    if(!reason.trim()){await appAlert('กรุณาระบุเหตุผล','warning');return;}
    if(!await appConfirm(`ยืนยัน${action==='approve'?'อนุมัติ':action==='reject'?'ไม่อนุมัติ':'ยกเลิก'}คำขอ #${row.id}?`))return;
    setBusy(true);
    try {if(!database)throw new Error('ไม่สามารถยืนยันฐานข้อมูลปัจจุบัน');
      await decideRebateConversionRequest(row.id,action,reason.trim(),database);await refresh();}
    catch(e:unknown){await appAlert((e as Error).message||'ดำเนินการไม่สำเร็จ','error');}
    finally{setBusy(false);}
  };
  return <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm space-y-3">
    <h2 className="font-bold text-[#0C447C]">คำขอแปลง Rebate เป็นตั๋ว</h2>
    <p className="text-xs text-gray-600">ยอดถูกจองเมื่อยื่น คืนเมื่อยกเลิกหรือไม่อนุมัติ และออกตั๋วเมื่อผู้มีสิทธิ์อนุมัติ</p>
    {unavailable && <p role="status" className="text-sm text-amber-700">ระบบคำขอแปลง Rebate ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล</p>}
    {canRequest && <div className="grid gap-2 sm:grid-cols-2">
      <div><label className="text-xs">ลูกค้า</label><SearchableSelect options={customers} value={custId} onChange={setCustId} placeholder="เลือกลูกค้า" /></div>
      <div><label className="text-xs">สินค้าที่รับ</label><SearchableSelect options={goods} value={goodId} onChange={setGoodId} placeholder="เลือกสินค้า" /></div>
      <label className="text-xs">ปีราคายืน 31 ต.ค. (ค.ศ.)<input type="number" value={year} onChange={e=>setYear(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label className="text-xs">จำนวนที่ขอ (ตัน)<input type="number" min="0" step="0.0001" value={tons} disabled={all} onChange={e=>setTons(e.target.value)} className="block w-full rounded border p-2 disabled:bg-gray-100" /></label>
      <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)} />ขอแปลงยอดที่ใช้ได้ทั้งหมด</label>
      <label className="text-xs">วันหมดอายุตั๋ว (เว้นว่างใช้ค่าเริ่มต้น)<input type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label className="text-xs sm:col-span-2">หมายเหตุ<input value={note} maxLength={500} onChange={e=>setNote(e.target.value)} className="block w-full rounded border p-2" /></label>
      <button type="button" disabled={busy||unavailable||items===null} onClick={submit} className="rounded bg-[#0C447C] p-2 text-sm text-white disabled:opacity-50">ยื่นคำขอ</button>
    </div>}
    {items && <div className="space-y-2"><p className="text-xs text-gray-500">แสดงคำขอล่าสุดไม่เกิน 50 รายการตามสิทธิ์</p>
      {items.length===0 && <p className="text-sm text-gray-500">ไม่มีคำขอที่แสดงได้</p>}
      {items.map(row=><div key={row.id} className="rounded border p-2 text-sm flex flex-wrap justify-between gap-2">
        <div><strong>#{row.id} · {row.custCode||row.custId} {row.custName||''}</strong> · {row.goodName||'สินค้า'} · {labels[row.status]||row.status}
          {row.amount!=null && <span> · ฿{row.amount.toLocaleString('th-TH',{minimumFractionDigits:2})}</span>}</div>
        <div className="flex gap-2">
          {row.canDecide && <><button disabled={busy} onClick={()=>decide(row,'approve')} className="text-green-700 underline">อนุมัติ</button>
            <button disabled={busy} onClick={()=>decide(row,'reject')} className="text-red-700 underline">ไม่อนุมัติ</button></>}
          {row.canCancel && <button disabled={busy} onClick={()=>decide(row,'cancel')} className="text-gray-700 underline">ยกเลิก</button>}
        </div>
      </div>)}
    </div>}
  </section>;
}
