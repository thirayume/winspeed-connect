import { useEffect, useState, useCallback } from 'react';
import { FileCheck, RefreshCw, Coins, Package, Info, CheckCircle, X } from 'lucide-react';
import {
  fetchRebateClaims, approveRebateClaim, fetchShippedToday,
} from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import type { RebateClaim, ShippedRow } from '../../types';

const STATUS_LABEL: Record<string, string> = {
  'Y': 'ชำระแล้ว',
  'N': 'ค้างชำระ',
  'P': 'บางส่วน',
  'C': 'ยกเลิก',
};
const STATUS_COLOR: Record<string, string> = {
  'Y': 'bg-green-100 text-green-700',
  'N': 'bg-blue-100 text-blue-700',
  'P': 'bg-yellow-100 text-yellow-700',
  'C': 'bg-red-100 text-red-500',
};

function today() {
  return new Date().toISOString().substring(0, 10);
}

export function AccountingPage() {
  const [shipped, setShipped] = useState<ShippedRow[]>([]);
  const [claims, setClaims]   = useState<RebateClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [date, setDate]       = useState(today());
  const [showInfo, setShowInfo] = useState(false);

  const load = useCallback(async (d = date) => {
    setLoading(true);
    try {
      const [shippedRes, claimsRes] = await Promise.all([
        fetchShippedToday(d),
        fetchRebateClaims('PENDING'),
      ]);
      setShipped(Array.isArray(shippedRes) ? shippedRes : []);
      setClaims(Array.isArray(claimsRes) ? claimsRes : []);
    } catch (e) {
      console.error(e);
      setShipped([]);
    }
    setLoading(false);
  }, [date]);

  useEffect(() => { load(date); }, []);

  useSocketEvent('so_updated', () => { load(date); });

  async function doApprove(claim: RebateClaim) {
    const cn = prompt(`กรอกเลขอ้างอิงเอกสาร WINSpeed สำหรับเคลม ฿${Number(claim.ClaimAmt).toLocaleString()}:\n(เว้นว่างได้ ถ้ายังไม่มีเลขเอกสาร)`);
    if (cn === null) return;
    setBusyId(claim.Id);
    try { await approveRebateClaim(claim.Id, cn || undefined); await load(date); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  const totalTon  = shipped.reduce((s, r) => s + (Number(r.TotalTon) || 0), 0);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <FileCheck className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> บัญชี / Winspeed
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">ออกของวันนี้ · อนุมัติเคลมรีเบท · อ้างอิงเอกสาร WINSpeed</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInfo(true)} className="h-10 w-10 flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600">
            <Info size={18} />
          </button>
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); load(e.target.value); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
          />
          <button onClick={() => load(date)} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-0 sm:p-6 space-y-2 sm:space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
              <CheckCircle size={20} />
            </div>
            <div>
              <div className="text-xs text-gray-400">ออกของวันนี้</div>
              <div className="text-2xl font-bold text-gray-800">{shipped.length}</div>
            </div>
          </div>
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Package size={20} />
            </div>
            <div>
              <div className="text-xs text-gray-400">รวมตัน</div>
              <div className="text-2xl font-bold text-gray-800">{totalTon.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
          </div>
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
              <Coins size={20} />
            </div>
            <div>
              <div className="text-xs text-gray-400">เคลมรีเบทรออนุมัติ</div>
              <div className="text-2xl font-bold text-gray-800">{claims.length}</div>
            </div>
          </div>
        </div>

        {/* Shipped today */}
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <CheckCircle size={16} className="text-green-500" />
              ออกของวันที่ {date} (จาก Winspeed)
            </h2>
            <span className="text-xs text-gray-400">{shipped.length} เอกสาร</span>
          </div>
          {loading ? (
            <div className="py-12 flex justify-center">
              <RefreshCw size={24} className="animate-spin text-gray-300" />
            </div>
          ) : shipped.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">ไม่มีเอกสารออกในวันที่เลือก</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                  <tr>
                    <th className="px-4 py-3 text-left whitespace-nowrap">#</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">เลขเอกสาร</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">ลูกค้า</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">ตัน</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">รายการ</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">รถ</th>
                    <th className="px-4 py-3 text-center whitespace-nowrap">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {shipped.map((row, i) => (
                    <tr key={row.Id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#0C447C] whitespace-nowrap">{row.WfRef}</td>
                      <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate" title={row.CustName}>{row.CustName}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-700 whitespace-nowrap">
                        {Number(row.TotalTon).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-500 whitespace-nowrap">{row.LineCount}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{row.TruckPlate || '-'}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[row.DocuStatus] || 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_LABEL[row.DocuStatus] || row.DocuStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Rebate claims */}
        <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <Coins size={16} className="text-orange-500" /> เคลมรีเบทรออนุมัติ
          </h2>
          {claims.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">ไม่มีเคลมรออนุมัติ</p>
          ) : (
            <div className="space-y-2">
              {claims.map(c => (
                <div key={c.Id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                  <div className="flex-1">
                    <span className="text-sm font-bold text-gray-700">
                      ฿{Number(c.ClaimAmt).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">{c.SalesName}</span>
                    {c.Note && <span className="ml-2 text-[10px] text-gray-400">{c.Note}</span>}
                  </div>
                  <button
                    disabled={busyId === c.Id}
                    onClick={() => doApprove(c)}
                    className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
                    style={{ background: '#0C447C' }}
                  >
                    {busyId === c.Id ? <RefreshCw size={14} className="animate-spin" /> : 'อนุมัติ + Ref'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowInfo(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2 text-blue-800">
                <Info size={20} /> ระบบซิงค์ข้อมูล
              </h2>
              <button onClick={() => setShowInfo(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="text-sm text-gray-600 space-y-3">
              <p><strong>Real-time Sync:</strong> เอกสารทั้งหมดที่สร้างจาก App จะถูก Sync เข้า Winspeed โดยอัตโนมัติเมื่อกด "ยืนยัน" (Confirm)</p>
              <p>ไม่ต้องดำเนินการใดๆ เพิ่มเติม เนื่องจาก App และ Winspeed ใช้ฐานข้อมูลเดียวกัน</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
