import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Search, X } from 'lucide-react';
import { ackIncident, fetchIncident, fetchIncidentTypes, fetchIncidents, shipSO, type IncidentDetail, type IncidentRow, type IncidentType } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { exportToCsv } from '../../utils/exportUtils';

const REVIEW_ROLES = ['MANAGER', 'ACCOUNTING', 'C_LEVEL', 'ADMIN'];
const MANAGER_ROLES = ['MANAGER', 'C_LEVEL', 'ADMIN'];
const SHIP_ROLES = ['WAREHOUSE', 'MANAGER', 'C_LEVEL', 'ADMIN'];
// the record did not close the bill by itself, so a person decides
const NEEDS_DECISION = ['WEIGHT_OUT_OF_TOLERANCE', 'PLATE_MISMATCH', 'SCALE_TONS_MISMATCH'];

const when = (v?: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-');

export function IncidentsPage() {
  const role = useAuthStore(s => s.user?.role) || '';
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [types, setTypes] = useState<IncidentType[]>([]);
  const [status, setStatus] = useState('OPEN');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [note, setNote] = useState('');
  const [manual, setManual] = useState({ gross: '', tare: '', reason: '', photo: '' });
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchIncidents({ status: status || undefined, type: type || undefined, search: search.trim() || undefined })); }
    catch (e) { setMessage((e as Error).message); }
    setLoading(false);
  }, [status, type, search]);

  useEffect(() => { fetchIncidentTypes().then(setTypes).catch(console.error); }, []);
  useEffect(() => { load(); }, [load]);

  async function open(id: number) {
    setMessage(''); setNote(''); setManual({ gross: '', tare: '', reason: '', photo: '' });
    try { setDetail(await fetchIncident(id)); } catch (e) { setMessage((e as Error).message); }
  }

  async function ack() {
    if (!detail) return;
    try { await ackIncident(detail.Id, note.trim()); setDetail(null); await load(); }
    catch (e) { setMessage((e as Error).message); }
  }

  async function confirmFromScale() {
    if (!detail?.SOID) return;
    try { await shipSO(detail.SOID); setMessage('บันทึกส่งออกตามบันทึกชั่งแล้ว'); await open(detail.Id); }
    catch (e) { setMessage((e as Error).message); }
  }

  async function shipByHand() {
    if (!detail?.SOID) return;
    try {
      await shipSO(detail.SOID, Number(manual.gross), {
        tareKg: Number(manual.tare), overrideReason: manual.reason.trim(), evidencePhotoUrl: manual.photo.trim(),
      });
      setMessage('บันทึกน้ำหนักด้วยตนเองแล้ว');
      await open(detail.Id);
    } catch (e) { setMessage((e as Error).message); }
  }

  const exportRows = () => exportToCsv('RuleIncidents', [
    { key: 'OccurredAt', label: 'เกิดเมื่อ', formatter: (v: string) => when(v) },
    { key: 'TypeLabel', label: 'เรื่อง' },
    { key: 'DocuNo', label: 'เอกสาร' },
    { key: 'CustName', label: 'ลูกค้า' },
    { key: 'SalesName', label: 'พนักงานขาย' },
    { key: 'Detail', label: 'รายละเอียด' },
    { key: 'Status', label: 'สถานะ', formatter: (v: string) => (v === 'ACK' ? 'ตรวจแล้ว' : 'รอตรวจ') },
    { key: 'AckByName', label: 'ผู้ตรวจ' },
    { key: 'AckNote', label: 'ผลการตรวจ' },
  ], rows);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> เหตุการณ์ผิดกฎ
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">งานที่ไม่เป็นไปตามขั้นตอน ไม่ได้หยุดงาน แต่บันทึกไว้เพื่อตรวจสอบและป้องกัน</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportRows} disabled={!rows.length} className="px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-[#0C447C] flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> Export (Excel)
          </button>
          <button onClick={load} aria-label="รีเฟรช" className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="px-4 py-3 sm:px-6 grid grid-cols-1 sm:grid-cols-[10rem_minmax(0,18rem)_minmax(0,1fr)] gap-2">
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="สถานะ" className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm">
          <option value="OPEN">รอตรวจ</option>
          <option value="ACK">ตรวจแล้ว</option>
          <option value="">ทั้งหมด</option>
        </select>
        <select value={type} onChange={e => setType(e.target.value)} aria-label="เรื่อง" className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm">
          <option value="">ทุกเรื่อง</option>
          {types.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-3 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาเลขเอกสาร ลูกค้า หรือรายละเอียด" className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm" />
        </div>
      </div>

      {message && !detail && <div className="mx-4 sm:mx-6 mb-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{message}</div>}

      <div className="flex-1 overflow-auto px-4 sm:px-6 pb-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[52rem]">
            <thead className="bg-gray-50 text-gray-500 text-xs text-left whitespace-nowrap">
              <tr>
                <th className="px-3 py-2">เกิดเมื่อ</th><th className="px-3 py-2">เรื่อง</th><th className="px-3 py-2">เอกสาร</th>
                <th className="px-3 py-2">ลูกค้า</th><th className="px-3 py-2">พนักงานขาย</th><th className="px-3 py-2">รายละเอียด</th><th className="px-3 py-2">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">{loading ? 'กำลังโหลด...' : 'ไม่มีรายการ'}</td></tr>}
              {rows.map(r => (
                <tr key={r.Id} data-testid={`incident-${r.Id}`} onClick={() => open(r.Id)} className="cursor-pointer hover:bg-blue-50/40">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{when(r.OccurredAt)}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{r.TypeLabel}</td>
                  <td className="px-3 py-2 font-mono text-[#0C447C] whitespace-nowrap">{r.DocuNo || '-'}</td>
                  <td className="px-3 py-2 text-gray-700">{r.CustName || '-'}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.SalesName || '-'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.Detail || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.Status === 'ACK'
                      ? <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700"><CheckCircle2 size={13} /> ตรวจแล้ว</span>
                      : <span className="text-xs font-bold text-amber-700">รอตรวจ</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={() => setDetail(null)}>
          <div role="dialog" aria-label="รายละเอียดเหตุการณ์" className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200">
              <div>
                <div className="font-bold text-gray-900">{detail.TypeLabel}</div>
                <div className="text-sm text-gray-500 mt-0.5">{detail.DocuNo || '-'} · {when(detail.OccurredAt)}</div>
                {detail.Detail && <div className="text-sm text-gray-700 mt-1">{detail.Detail}</div>}
              </div>
              <button onClick={() => setDetail(null)} aria-label="ปิด" className="p-1 text-gray-500 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="overflow-auto px-5 py-4 space-y-4">
              {detail.timeline.booking && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div><span className="text-gray-500">ลูกค้า: </span>{detail.timeline.booking.CustName || '-'}</div>
                  <div><span className="text-gray-500">พนักงานขาย: </span>{detail.timeline.booking.SalesName || '-'}</div>
                  <div><span className="text-gray-500">ใบสั่งจอง (103): </span>{detail.timeline.booking.DocuNo || '-'}</div>
                  <div><span className="text-gray-500">ใบอนุมัติ (AI): </span>{detail.timeline.booking.AppvDocuNo || 'ยังไม่อนุมัติ'}{detail.timeline.booking.ApproverName ? ` · ${detail.timeline.booking.ApproverName}` : ''}</div>
                  <div><span className="text-gray-500">ใบสั่งขาย (104): </span>{detail.timeline.deliveries.map(d => d.DocuNo).join(', ') || '-'}</div>
                  <div><span className="text-gray-500">ใบส่งของ (107): </span>{detail.timeline.invoices.filter(i => Number(i.Docutype) === 107).map(i => i.DocuNo).join(', ') || '-'}</div>
                </div>
              )}
              <div>
                <div className="text-xs font-bold text-gray-500 mb-2">ลำดับการทำงาน ตั้งแต่ต้นทางจนจบ</div>
                {detail.timeline.steps.length === 0 && <div className="text-sm text-gray-400">ไม่พบบันทึกการทำงาน</div>}
                <ol className="space-y-1.5">
                  {detail.timeline.steps.map((s, i) => (
                    <li key={i} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 text-sm">
                      <span className="text-gray-500 whitespace-nowrap">{when(s.at)}</span>
                      <span className="text-gray-800">{s.step}{s.doc ? ` · ${s.doc}` : ''}{s.who ? ` · ${s.who}` : ''}{s.note ? ` · ${s.note}` : ''}</span>
                    </li>
                  ))}
                </ol>
              </div>
              {detail.Status === 'ACK' && (
                <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">ตรวจแล้วเมื่อ {when(detail.AckAt)}: {detail.AckNote}</div>
              )}
              {detail.SOID && NEEDS_DECISION.includes(detail.IncidentType) && SHIP_ROLES.includes(role) && (
                <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                  <div className="text-sm font-bold text-gray-700">ระบบไม่ปิดบิลนี้ให้อัตโนมัติ ต้องให้คนตัดสิน</div>
                  <button onClick={confirmFromScale} className="px-3 py-2 rounded-xl bg-[#0C447C] text-white text-sm font-bold">ยืนยันส่งออกตามบันทึกชั่ง</button>
                  {MANAGER_ROLES.includes(role) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <label className="text-xs text-gray-500">น้ำหนักรถพร้อมของ (กก.)<input type="number" value={manual.gross} onChange={e => setManual({ ...manual, gross: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm" /></label>
                      <label className="text-xs text-gray-500">น้ำหนักรถเปล่า (กก.)<input type="number" value={manual.tare} onChange={e => setManual({ ...manual, tare: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm" /></label>
                      <label className="text-xs text-gray-500">เหตุผลที่บันทึกชั่งไม่ถูกต้อง<input value={manual.reason} onChange={e => setManual({ ...manual, reason: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm" /></label>
                      <label className="text-xs text-gray-500">ลิงก์รูปหลักฐาน<input value={manual.photo} onChange={e => setManual({ ...manual, photo: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm" /></label>
                      <button onClick={shipByHand} className="sm:col-span-2 px-3 py-2 rounded-xl border border-[#0C447C] text-[#0C447C] text-sm font-bold">บันทึกน้ำหนักด้วยตนเอง</button>
                    </div>
                  )}
                </div>
              )}
              {detail.Status === 'OPEN' && REVIEW_ROLES.includes(role) && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 block">ผลการตรวจสอบ
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal text-gray-800" />
                  </label>
                  <button onClick={ack} className="px-3 py-2 rounded-xl bg-green-700 text-white text-sm font-bold">บันทึกว่าตรวจแล้ว</button>
                </div>
              )}
              {message && <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{message}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
