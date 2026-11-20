import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { req } from '../../services/api';

type Sample = { ref: string; docuNo: string | null; appQty: number | null; winspeedQty: number | null; detail: string };
type Issue = { count: number; sample: Sample[] };
type DbResult = {
  database: string; matches: boolean; issueCount: number;
  giveaway: { usageRows: number; usageQty: number; countedQty: number; zeroAt: string | null; issues: Record<string, Issue> };
  rebate: { generation: number | null; lots: number; lotTon: number; lotBaht: number; ticketUses: number; plans: number; issues: Record<string, Issue> };
};
type SyncResult = { checkedAt: string; windowStart: string; matches: boolean; databases: DbResult[] };

const ISSUE_LABEL: Record<string, string> = {
  usageOnCancelledBill: 'ของแถม: ตัดโควต้าแล้ว แต่ใบจองถูกยกเลิกหรือไม่มีใน WinSpeed',
  billWithoutUsage: 'ของแถม: บิลมีของแถม แต่ยังไม่ได้ตัดโควต้า',
  piecesMismatch: 'ของแถม: จำนวนชิ้นในบิลไม่เท่ายอดที่ตัดโควต้า',
  lotSourceChanged: 'Rebate: ใบตัดตั๋ว (116) ถูกแก้ ยกเลิก หรือไม่มีแล้ว',
  lotOrderCancelled: 'Rebate: ใบสั่งขาย (104) ถูกยกเลิกหรือไม่มีแล้ว',
  useOnCancelledBooking: 'Rebate: ใช้ตั๋วกับใบจองที่ถูกยกเลิก หรือบรรทัดเหลือน้อยกว่าที่ใช้',
};
const n = (v: number, d = 2) => v.toLocaleString('th-TH', { maximumFractionDigits: d });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : '-');

/**
 * Owner, 21 Nov 2026: Sale-App giveaway and Rebate counts must agree with WinSpeed, on every company database.
 * Read-only; each row names the WinSpeed document to open.
 */
export function WinspeedSyncPanel() {
  const [data, setData] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { setData(await req<SyncResult>('/recon/winspeed-sync', { silent: true })); }
    catch (e) { setError(e instanceof Error ? e.message : 'ตรวจยอดกับ WinSpeed ไม่สำเร็จ'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4" data-testid="winspeed-sync-panel">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800">ยอดของแถมและ Rebate ตรงกับ WinSpeed หรือไม่</h2>
          <p className="text-xs text-gray-500 mt-1">ตรวจทุกฐานบริษัท อ่านอย่างเดียว ไม่แก้ข้อมูลใด
            {data && <> · ตรวจเมื่อ {when(data.checkedAt)} · ข้อมูลตั้งแต่ {data.windowStart}</>}</p>
        </div>
        <button type="button" onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#0C447C] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> ตรวจอีกครั้ง
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {data?.databases.map(d => (
        <section key={d.database} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-gray-800">{d.database}</span>
            {d.matches
              ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700"><CheckCircle2 size={13} /> ตรงกับ WinSpeed</span>
              : <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700"><AlertTriangle size={13} /> ต้องตรวจ {d.issueCount} รายการ</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 text-xs text-gray-600">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="font-bold text-gray-700">ของแถม (นับตั้งแต่ Set Zero {when(d.giveaway.zeroAt)})</p>
              <p>ตัดโควต้า {n(d.giveaway.usageRows, 0)} รายการ รวม {n(d.giveaway.usageQty)} ชิ้น · ยอดเบิกที่นับในงบ {n(d.giveaway.countedQty)} ชิ้น</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="font-bold text-gray-700">Rebate (รอบ {d.rebate.generation ?? '-'})</p>
              <p>แผน {n(d.rebate.plans, 0)} · ล็อตสะสม {n(d.rebate.lots, 0)} ({n(d.rebate.lotTon, 3)} ตัน, {n(d.rebate.lotBaht)} บาท) · ใช้ตั๋ว {n(d.rebate.ticketUses, 0)} ครั้ง</p>
              {d.rebate.plans === 0 && <p className="text-amber-700 mt-1">ยังไม่มีแผน Rebate จึงยังไม่มียอดสะสม</p>}
            </div>
          </div>
          {[...Object.entries(d.giveaway.issues), ...Object.entries(d.rebate.issues)].filter(([, i]) => i.count > 0).map(([key, i]) => (
            <div key={key} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <p className="text-xs font-bold text-amber-800">{ISSUE_LABEL[key] || key} · {n(i.count, 0)} รายการ</p>
              <table className="mt-2 w-full text-xs">
                <thead className="text-left text-gray-500"><tr><th className="py-1">เอกสาร WinSpeed</th><th className="py-1 text-right">Sale-App</th><th className="py-1 text-right">WinSpeed</th><th className="py-1">รายละเอียด</th></tr></thead>
                <tbody>
                  {i.sample.map(s => (
                    <tr key={`${key}-${s.ref}`} className="border-t border-amber-100">
                      <td className="py-1 font-mono">{s.docuNo || `#${s.ref}`}</td>
                      <td className="py-1 text-right">{s.appQty == null ? '-' : n(s.appQty, 3)}</td>
                      <td className="py-1 text-right">{s.winspeedQty == null ? '-' : n(s.winspeedQty, 3)}</td>
                      <td className="py-1">{s.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {i.count > i.sample.length && <p className="mt-1 text-[11px] text-gray-500">แสดง {i.sample.length} รายการแรก</p>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
