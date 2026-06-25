import { useEffect, useState, useCallback } from 'react';
import { FileCheck, RefreshCw, FolderOpen, Coins } from 'lucide-react';
import {
  fetchSalesOrders, syncImported, fetchRebateClaims, approveRebateClaim,
} from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import type { SalesOrder, RebateClaim } from '../../types';

export function AccountingPage() {
  const [shipped, setShipped] = useState<SalesOrder[]>([]);
  const [claims, setClaims]   = useState<RebateClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        fetchSalesOrders({ status: 'SHIPPED', limit: 100 }),
        fetchRebateClaims('PENDING'),
      ]);
      setShipped(s.data || []);
      setClaims(c);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Listen for real-time updates
  useSocketEvent('so_updated', () => {
    console.log('[Socket] so_updated event received. Refreshing AccountingPage...');
    load();
  });

  async function doSync(so: SalesOrder) {
    const docuNo = prompt(`กรอกเลขใบกำกับ WINSpeed (DocuNo) สำหรับ ${so.wfRef}:`);
    if (!docuNo) return;
    setBusyId(so.id!);
    try { await syncImported(so.id!, docuNo); await load(); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function doApprove(claim: RebateClaim) {
    const cn = prompt(`กรอกเลข CN (Credit Note 109) จาก WINSpeed สำหรับเคลม ฿${Number(claim.ClaimAmt).toLocaleString()}:`);
    if (cn === null) return;
    setBusyId(claim.Id);
    try { await approveRebateClaim(claim.Id, cn || undefined); await load(); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <FileCheck size={26} /> บัญชี / Sync WINSpeed
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">ยืนยัน DocuNo ใบกำกับ · อนุมัติเคลมรีเบท → CN (109)</p>
        </div>
        <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* SHIPPED → sync DocuNo */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <FolderOpen size={16} /> ใบสั่งขายที่ส่งออกแล้ว (รอ Import เข้า WINSpeed)
          </h2>
          {shipped.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">ไม่มีรายการรอ sync</p>
          ) : (
            <div className="space-y-2">
              {shipped.map(so => (
                <div key={so.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs font-bold text-gray-700">{so.wfRef}</span>
                    <span className="ml-2 text-xs text-gray-500">{so.custName}</span>
                    {so.importFilePath && (
                      <div className="text-[10px] text-gray-400 truncate mt-0.5">📁 {so.importFilePath}</div>
                    )}
                  </div>
                  <button disabled={busyId === so.id} onClick={() => doSync(so)}
                    className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50" style={{ background: '#059669' }}>
                    กรอก DocuNo → IMPORTED
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending rebate claims → approve with CN */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <Coins size={16} /> เคลมรีเบทรออนุมัติ
          </h2>
          {claims.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">ไม่มีเคลมรออนุมัติ</p>
          ) : (
            <div className="space-y-2">
              {claims.map(c => (
                <div key={c.Id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                  <div className="flex-1">
                    <span className="text-sm font-bold text-gray-700">฿{Number(c.ClaimAmt).toLocaleString('th-TH',{maximumFractionDigits:0})}</span>
                    <span className="ml-2 text-xs text-gray-500">{c.SalesName}</span>
                    {c.Note && <span className="ml-2 text-[10px] text-gray-400">{c.Note}</span>}
                  </div>
                  <button disabled={busyId === c.Id} onClick={() => doApprove(c)}
                    className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50" style={{ background: '#0C447C' }}>
                    อนุมัติ + CN
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
