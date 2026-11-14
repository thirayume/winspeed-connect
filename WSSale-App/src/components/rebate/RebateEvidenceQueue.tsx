import { useState } from 'react';
import { fetchRebateShipmentEvidence, stageRebateShipmentEvidence, reviewRebateShipmentEvidence,
  type RebateShipmentEvidence } from '../../services/api';

export function RebateEvidenceQueue() {
  const [rows,setRows]=useState<RebateShipmentEvidence[]>([]);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [source,setSource]=useState('');
  const [line,setLine]=useState('');
  const [selected,setSelected]=useState<RebateShipmentEvidence | null>(null);
  const [when,setWhen]=useState('');
  const [reason,setReason]=useState('');
  const refresh=async()=>{
    setLoading(true);setError('');
    try {setRows((await fetchRebateShipmentEvidence()).data);}
    catch(e:unknown){setRows([]);setError(e instanceof Error?e.message:'โหลดคิวหลักฐานไม่สำเร็จ');}
    finally{setLoading(false);}
  };
  const stage=async()=>{
    const a=Number(source),b=Number(line);
    if(!/^\d+$/.test(source)||!/^\d+$/.test(line)||![a,b].every(n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647)) {
      setError('กรุณากรอก ID ใบขนและลำดับรายการให้ถูกต้อง');return;
    }
    setLoading(true);setError('');
    try{await stageRebateShipmentEvidence(a,b);setSource('');setLine('');await refresh();}
    catch(e:unknown){setError(e instanceof Error?e.message:'เพิ่มรายการไม่สำเร็จ');}
    finally{setLoading(false);}
  };
  const review=async(decision:'VERIFY'|'REJECT')=>{
    if(!selected || !reason.trim() || (decision==='VERIFY' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when))) {
      setError('กรุณาระบุเหตุผลและเวลาขนส่งตามหลักฐาน');return;
    }
    setLoading(true);setError('');
    try {
      await reviewRebateShipmentEvidence(selected.Id,{expectedRevision:selected.Revision,decision,
        ...(decision==='VERIFY'?{occurredAtUtc:`${when}:00+07:00`}:{}),reason:reason.trim()});
      setSelected(null);setWhen('');setReason('');await refresh();
    } catch(e:unknown){setError(e instanceof Error?e.message:'ตรวจหลักฐานไม่สำเร็จ');}
    finally{setLoading(false);}
  };
  return <section className="rounded-xl border border-amber-200 bg-white p-4">
    <button type="button" aria-expanded={open} className="font-bold text-[#0C447C]" onClick={()=>{setOpen(!open);if(!open)void refresh();}}>
      {open?'ซ่อน':'ดู'}รายการขนส่งที่รอตรวจหลักฐาน
    </button>
    {open && <div className="mt-3 space-y-3">
      <p className="text-sm text-gray-600">คิวนี้แสดงเฉพาะรายการขนส่งที่ต้องตรวจเพิ่มเติม เช่น เวลาขนส่งหรือราคาต้นทางยังยืนยันไม่ได้ ไม่ใช่ยอด Rebate รวมของลูกค้า ผู้มีสิทธิ์ตรวจหลักฐานก่อนนำรายการมาคำนวณ</p>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="rebate-116-id">ID ใบขน 116</label>
        <input id="rebate-116-id" inputMode="numeric" value={source} onChange={e=>setSource(e.target.value)} placeholder="ID ใบขน 116" className="rounded border px-2 py-1" />
        <label className="sr-only" htmlFor="rebate-116-line">ลำดับรายการใบขน</label>
        <input id="rebate-116-line" inputMode="numeric" value={line} onChange={e=>setLine(e.target.value)} placeholder="ลำดับรายการ" className="rounded border px-2 py-1" />
        <button type="button" disabled={loading} onClick={stage} className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50">เพิ่มเข้าคิว</button>
        <button type="button" disabled={loading} onClick={refresh} className="rounded border px-3 py-1">รีเฟรช</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!error && !rows.length && !loading && <p className="text-sm text-gray-500">ไม่มีรายการพักที่แสดงในช่วงข้อมูลนี้</p>}
      {rows.map(row=><div key={row.Id} className="rounded border p-3 text-sm">
        <p className="font-semibold">{row.DocuNo ? `ใบขน ${row.DocuNo} · รายการ ${row.RedemptionListNo} · ${row.DocuDate}` : `รายการพัก #${row.Id} จากเอกสารก่อนวันเริ่มข้อมูล`}</p>
        <p>จำนวน {row.QuantityTon ?? 'ยังไม่ยืนยัน'} ตัน · เหตุพัก {row.HoldReason}</p>
        <button type="button" onClick={()=>{setSelected(row);setWhen('');setReason('');setError('');}} className="mt-2 rounded border border-blue-300 px-2 py-1 text-blue-700">ตรวจหลักฐาน</button>
      </div>)}
      {selected && <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
        <p className="font-semibold">ตรวจ {selected.DocuNo ? `${selected.DocuNo} รายการ ${selected.RedemptionListNo}` : `รายการพัก #${selected.Id} จากเอกสารก่อนวันเริ่มข้อมูล`}</p>
        <label className="block text-sm">เวลาขนส่งจริงตามหลักฐาน (เวลาไทย)
          <input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} className="ml-2 rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">เหตุผลและเอกสารอ้างอิง
          <textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} className="mt-1 block w-full rounded border p-2" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={loading} onClick={()=>review('VERIFY')} className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50">ยืนยันหลักฐาน</button>
          <button type="button" disabled={loading} onClick={()=>review('REJECT')} className="rounded border border-red-300 px-3 py-1 text-red-700">ปฏิเสธ</button>
          <button type="button" disabled={loading} onClick={()=>setSelected(null)} className="rounded border px-3 py-1">ยกเลิก</button>
        </div>
      </div>}
    </div>}
  </section>;
}
