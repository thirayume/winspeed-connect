import { useEffect, useState, useCallback } from 'react';
import { Landmark, RefreshCw, CreditCard, Boxes, ShieldAlert, Download, Trash2, Save } from 'lucide-react';
import {
  fetchCredits, setCredit, fetchStock, setStock,
  fetchRetentionPolicies, updateRetentionPolicy, fetchDsarLog, dsarExport, runRetention,
  type CreditInfo, type StockRow, type RetentionPolicy, type DsarRow,
} from '../../services/api';

type Tab = 'credit' | 'stock' | 'pdpa';

export function DataGovernancePage() {
  const [tab, setTab] = useState<Tab>('credit');
  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm">
        <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}><Landmark className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> การกำกับข้อมูล</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">เครดิตลูกค้า (FR-003) · สต๊อกปฏิบัติการ (DG-04) · PDPA/DSAR (FR-032)</p>
        <div className="flex gap-2 mt-3">
          {([['credit', 'เครดิตลูกค้า', CreditCard], ['stock', 'สต๊อกปฏิบัติการ', Boxes], ['pdpa', 'PDPA / DSAR', ShieldAlert]] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${tab === k ? 'bg-[#0C447C] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}><Icon size={15} /> {l}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-0 sm:p-6">
        {tab === 'credit' && <CreditTab />}
        {tab === 'stock' && <StockTab />}
        {tab === 'pdpa' && <PdpaTab />}
      </div>
    </div>
  );
}

function CreditTab() {
  const [rows, setRows] = useState<CreditInfo[]>([]);
  const [f, setF] = useState({ custId: '', custName: '', creditLimit: '', creditHold: false, note: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setRows(await fetchCredits()); } catch (e) { console.error(e); } }, []);
  useEffect(() => { load(); }, [load]);
  async function save() {
    if (!f.custId) { alert('ใส่รหัสลูกค้า'); return; }
    setBusy(true);
    try { await setCredit(f.custId, { custName: f.custName || undefined, creditLimit: f.creditLimit ? Number(f.creditLimit) : null, creditHold: f.creditHold, note: f.note || undefined }); setF({ custId: '', custName: '', creditLimit: '', creditHold: false, note: '' }); await load(); }
    catch (e: unknown) { alert((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">ตั้ง/แก้เครดิตลูกค้า</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <label className="text-xs text-gray-500">รหัสลูกค้า<input value={f.custId} onChange={e => setF({ ...f, custId: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">ชื่อ<input value={f.custName} onChange={e => setF({ ...f, custName: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">วงเงิน<input value={f.creditLimit} onChange={e => setF({ ...f, creditLimit: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500 flex flex-col">ระงับเครดิต<span className="mt-2"><input type="checkbox" checked={f.creditHold} onChange={e => setF({ ...f, creditHold: e.target.checked })} /> Hold</span></label>
          <label className="text-xs text-gray-500">หมายเหตุ<input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
          <button onClick={save} disabled={busy} className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40"><Save size={14} /> บันทึก</button>
        </div>
      </div>
      <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm min-w-full">
          <thead className="whitespace-nowrap"><tr className="bg-gray-50 text-gray-500 text-xs uppercase"><th className="text-left px-4 py-3 whitespace-nowrap">ลูกค้า</th><th className="text-right px-4 py-3 whitespace-nowrap">วงเงิน</th><th className="text-center px-4 py-3 whitespace-nowrap">สถานะ</th><th className="text-left px-4 py-3 whitespace-nowrap">หมายเหตุ</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 whitespace-nowrap">ยังไม่มีข้อมูลเครดิต</td></tr>}
            {rows.map(c => (
              <tr key={c.CustId}>
                <td className="px-4 py-3 whitespace-nowrap"><span className="font-semibold text-gray-800">{c.CustId}</span> <span className="text-gray-500">{c.CustName}</span></td>
                <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">{c.CreditLimit == null ? '—' : `฿${Number(c.CreditLimit).toLocaleString()}`}</td>
                <td className="px-4 py-3 text-center whitespace-nowrap">{c.CreditHold ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-600">ระงับ</span> : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">ปกติ</span>}</td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{c.Note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockTab() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [f, setF] = useState({ goodId: '', goodName: '', qtyOnHand: '', unit: 'ตัน' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setRows(await fetchStock()); } catch (e) { console.error(e); } }, []);
  useEffect(() => { load(); }, [load]);
  async function save() {
    if (!f.goodId) { alert('ใส่รหัสสินค้า'); return; }
    setBusy(true);
    try { await setStock({ goodId: f.goodId, goodName: f.goodName || undefined, qtyOnHand: Number(f.qtyOnHand) || 0, unit: f.unit }); setF({ goodId: '', goodName: '', qtyOnHand: '', unit: 'ตัน' }); await load(); }
    catch (e: unknown) { alert((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">DG-04 (open decision): แหล่งสต๊อกปฏิบัติการที่อนุมัติแล้วใน wf — ไม่ดึงจาก dbo.ICStock โดยตรง</div>
      <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">ป้อน/แก้สต๊อก</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <label className="text-xs text-gray-500">รหัสสินค้า<input value={f.goodId} onChange={e => setF({ ...f, goodId: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">ชื่อ<input value={f.goodName} onChange={e => setF({ ...f, goodName: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">คงเหลือ<input value={f.qtyOnHand} onChange={e => setF({ ...f, qtyOnHand: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">หน่วย<input value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
          <button onClick={save} disabled={busy} className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40"><Save size={14} /> บันทึก</button>
        </div>
      </div>
      <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm min-w-full">
          <thead className="whitespace-nowrap"><tr className="bg-gray-50 text-gray-500 text-xs uppercase"><th className="text-left px-4 py-3 whitespace-nowrap">สินค้า</th><th className="text-right px-4 py-3 whitespace-nowrap">คงเหลือ</th><th className="text-left px-4 py-3 whitespace-nowrap">คลัง</th><th className="text-left px-4 py-3 whitespace-nowrap">อัปเดต</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 whitespace-nowrap">ยังไม่มีข้อมูลสต๊อก</td></tr>}
            {rows.map(s => (
              <tr key={`${s.GoodId}|${s.WarehouseId}`}>
                <td className="px-4 py-3 whitespace-nowrap"><span className="font-semibold text-gray-800">{s.GoodId}</span> <span className="text-gray-500">{s.GoodName}</span></td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{Number(s.QtyOnHand).toLocaleString()} {s.Unit}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{s.WarehouseId}</td>
                <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{s.AsOf ? new Date(s.AsOf).toLocaleString('th-TH') : ''} {s.UpdatedByName ? `· ${s.UpdatedByName}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PdpaTab() {
  const [pol, setPol] = useState<RetentionPolicy[]>([]);
  const [log, setLog] = useState<DsarRow[]>([]);
  const [subj, setSubj] = useState({ type: 'CUSTOMER' as 'CUSTOMER' | 'USER', id: '' });
  const [exp, setExp] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const [p, l] = await Promise.all([fetchRetentionPolicies(), fetchDsarLog()]); setPol(p); setLog(l); } catch (e) { console.error(e); } }, []);
  useEffect(() => { load(); }, [load]);
  async function savePol(p: RetentionPolicy, days: number) { try { await updateRetentionPolicy(p.Id, days); await load(); } catch (e: unknown) { alert((e as Error).message); } }
  async function doExport() {
    if (!subj.id) { alert('ใส่รหัส subject'); return; }
    setBusy(true);
    try { const r = await dsarExport(subj.type, subj.id); setExp(JSON.stringify(r.data, null, 2)); await load(); }
    catch (e: unknown) { alert((e as Error).message); } finally { setBusy(false); }
  }
  async function doRetention() {
    if (!confirm('รัน retention purge ตามนโยบาย? (ลบข้อมูลเก่าถาวร)')) return;
    setBusy(true);
    try { const r = await runRetention(); alert('เสร็จ: ' + JSON.stringify(r.result)); }
    catch (e: unknown) { alert((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3"><span className="text-sm font-semibold text-gray-700">นโยบายการเก็บข้อมูล (วัน)</span>
            <button onClick={doRetention} disabled={busy} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash2 size={13} /> รัน purge</button>
          </div>
          {pol.map(p => (
            <div key={p.Id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
              <div><div className="text-sm font-medium text-gray-700">{p.DataClass}</div><div className="text-xs text-gray-400">{p.Note}</div></div>
              <input defaultValue={p.RetentionDays} onBlur={e => { const v = Number(e.target.value); if (v && v !== p.RetentionDays) savePol(p, v); }} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">DSAR — ส่งออกข้อมูลส่วนบุคคล</div>
          <div className="flex gap-2 items-end">
            <label className="text-xs text-gray-500">ประเภท<select value={subj.type} onChange={e => setSubj({ ...subj, type: e.target.value as 'CUSTOMER' | 'USER' })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm"><option value="CUSTOMER">ลูกค้า</option><option value="USER">ผู้ใช้</option></select></label>
            <label className="text-xs text-gray-500 flex-1">รหัส<input value={subj.id} onChange={e => setSubj({ ...subj, id: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" /></label>
            <button onClick={doExport} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40"><Download size={14} /> ส่งออก</button>
          </div>
          {exp && <pre className="mt-3 bg-gray-50 rounded-lg p-2 text-[11px] text-gray-600 max-h-48 overflow-auto">{exp}</pre>}
        </div>
      </div>
      <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-700">DSAR Log</div>
        <table className="w-full text-sm min-w-full">
          <thead className="whitespace-nowrap"><tr className="bg-gray-50 text-gray-500 text-xs uppercase"><th className="text-left px-4 py-2 whitespace-nowrap">เวลา</th><th className="text-left px-4 py-2 whitespace-nowrap">ประเภท</th><th className="text-left px-4 py-2 whitespace-nowrap">Subject</th><th className="text-left px-4 py-2 whitespace-nowrap">การกระทำ</th><th className="text-left px-4 py-2 whitespace-nowrap">โดย</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {log.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 whitespace-nowrap">ยังไม่มีคำขอ</td></tr>}
            {log.map(d => (<tr key={d.Id}><td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(d.RequestedAt).toLocaleString('th-TH')}</td><td className="px-4 py-2 whitespace-nowrap">{d.SubjectType}</td><td className="px-4 py-2 text-gray-700 whitespace-nowrap">{d.SubjectId}</td><td className="px-4 py-2 whitespace-nowrap">{d.Action}</td><td className="px-4 py-2 text-gray-500 whitespace-nowrap">{d.ByName}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
