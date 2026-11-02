import { useEffect, useState, useCallback } from 'react';
import { Boxes, Save } from 'lucide-react';
import { fetchStock, setStock, fetchAtpStock, fetchGoods, type StockRow, type AtpStockRow } from '../../services/api';
import type { EMGood } from '../../types';

const STATE_LABEL: Record<AtpStockRow['state'], { text: string; cls: string }> = {
  FULLY_READY: { text: 'พร้อมจ่าย', cls: 'bg-green-100 text-green-700' },
  PARTIALLY_READY: { text: 'พร้อมบางส่วน', cls: 'bg-amber-100 text-amber-700' },
  SHORTAGE: { text: 'ยอดจองเกินของที่มี', cls: 'bg-red-100 text-red-600' },
  OUT_OF_STOCK: { text: 'ไม่มีของ', cls: 'bg-red-100 text-red-600' },
  UNKNOWN: { text: 'ข้อมูลไม่ชัดเจน', cls: 'bg-gray-100 text-gray-600' },
};

const fmt = (n: number | undefined) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 }));

/** DG-04: ยอดที่คลังป้อนเอง ระบบใช้แสดงป้ายและเตือนในหน้าสร้างบิลเท่านั้น ไม่ได้ห้ามออกบิล */
export function StockTab() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [atp, setAtp] = useState<AtpStockRow[]>([]);
  const [goods, setGoods] = useState<EMGood[]>([]);
  const [f, setF] = useState({ goodId: '', qtyOnHand: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [stock, summary] = await Promise.all([fetchStock(), fetchAtpStock()]);
      setRows(stock);
      setAtp(summary.data || []);
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { load(); fetchGoods().then(setGoods).catch(console.error); }, [load]);
  async function save() {
    if (!f.goodId) { alert('เลือกสินค้า'); return; }
    if (f.qtyOnHand.trim() === '' || !(Number(f.qtyOnHand) >= 0)) { alert('ใส่จำนวนคงเหลือเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'); return; }
    setBusy(true);
    try { await setStock({ goodId: f.goodId, qtyOnHand: Number(f.qtyOnHand), unit: 'ตัน' }); setF({ goodId: '', qtyOnHand: '' }); await load(); }
    catch (e: unknown) { alert((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">ยอดนี้คลังเป็นผู้ป้อนเอง ไม่ได้ดึงจาก WinSpeed ใช้แสดงสถานะและเตือนฝ่ายขายเท่านั้น ไม่ได้ห้ามออกบิล ถ้าไม่อัปเดตเกินกำหนดระบบจะแสดงว่าข้อมูลไม่ชัดเจน ยอดจองนับจากใบจองที่ยังเปิดใน WinSpeed ไม่รวมรถที่ชั่งออกแล้ว จึงอาจสูงเกินจริงจนกว่าจะปิดใบจองค้างเก่า และยังไม่หักตั๋วปุ๋ยที่ขายแล้วแต่ยังไม่เบิก</div>
      <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">ป้อน/แก้สต๊อก</div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_10rem_auto] gap-2 items-end">
          <label className="text-xs text-gray-500">สินค้า
            <select data-testid="stock-good" value={f.goodId} onChange={e => setF({ ...f, goodId: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white">
              <option value="">— เลือกสินค้า —</option>
              {goods.map(g => <option key={g.GoodID} value={String(g.GoodCode).trim()}>{String(g.GoodCode).trim()} · {g.GoodName}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">คงเหลือ (ตัน)
            <input data-testid="stock-qty" type="number" min="0" step="0.01" inputMode="decimal" value={f.qtyOnHand} onChange={e => setF({ ...f, qtyOnHand: e.target.value })} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" />
          </label>
          <button data-testid="stock-save" onClick={save} disabled={busy} className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40"><Save size={14} /> บันทึก</button>
        </div>
      </div>
      <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-full">
          <thead className="whitespace-nowrap"><tr className="bg-gray-50 text-gray-500 text-xs uppercase"><th className="text-left px-4 py-3 whitespace-nowrap">สินค้า</th><th className="text-right px-4 py-3 whitespace-nowrap">คงเหลือ</th><th className="text-right px-4 py-3 whitespace-nowrap">ยอดจอง</th><th className="text-right px-4 py-3 whitespace-nowrap">พร้อมจ่าย</th><th className="text-center px-4 py-3 whitespace-nowrap">สถานะ</th><th className="text-left px-4 py-3 whitespace-nowrap">อัปเดต</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 whitespace-nowrap">ยังไม่มีข้อมูลสต๊อก</td></tr>}
            {rows.map(s => {
              const a = atp.find(r => r.goodCode === String(s.GoodId).trim());
              const label = a ? STATE_LABEL[a.state] : undefined;
              return (
                <tr key={`${s.GoodId}|${s.WarehouseId}`} data-testid={`stock-row-${String(s.GoodId).trim()}`}>
                  <td className="px-4 py-3 whitespace-nowrap"><span className="font-semibold text-gray-800">{s.GoodId}</span> <span className="text-gray-500">{s.GoodName}</span></td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmt(s.QtyOnHand)} {s.Unit}</td>
                  <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">{fmt(a?.unallocatedDemand)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmt(a?.totalAvailable)}</td>
                  <td className="px-4 py-3 text-center whitespace-nowrap" title={a?.stateReason || undefined}>{label ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${label.cls}`}>{label.text}</span> : '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{s.AsOf ? new Date(s.AsOf).toLocaleString('th-TH') : ''} {s.UpdatedByName ? `· ${s.UpdatedByName}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OperationalStockPage() {
  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm">
        <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}><Boxes className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> สต๊อกปฏิบัติการ</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">ยอดคงเหลือ · ยอดจอง · พร้อมจ่าย</p>
      </div>
      <div className="flex-1 overflow-y-auto p-0 sm:p-6"><StockTab /></div>
    </div>
  );
}
