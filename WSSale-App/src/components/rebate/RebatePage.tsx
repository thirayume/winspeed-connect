import { useEffect, useState, useCallback } from 'react';
import { Coins, RefreshCw, ArrowRight, Scissors, X } from 'lucide-react';
import {
  fetchRebatePools, fetchRebateLedger, fetchRebateClaims, createRebateClaim,
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { RebatePool, RebateLedger, RebateClaim } from '../../types';

export function RebatePage() {
  const role = useAuthStore(s => s.user?.role);
  const [pools, setPools]       = useState<RebatePool[]>([]);
  const [claims, setClaims]     = useState<RebateClaim[]>([]);
  const [selectedPool, setSelectedPool] = useState<RebatePool | null>(null);
  const [ledger, setLedger]     = useState<RebateLedger[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showClaim, setShowClaim] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([fetchRebatePools(), fetchRebateClaims()]);
      setPools(p);
      setClaims(c);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openPool(pool: RebatePool) {
    setSelectedPool(pool);
    try { setLedger(await fetchRebateLedger({ poolId: pool.Id })); }
    catch (e) { console.error(e); setLedger([]); }
  }

  const monthLabel = (p: RebatePool) => `${p.PeriodMonth}/${p.PeriodYear}`;

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Coins size={26} /> รีเบท (Rebate)
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Pool รายเดือน · Ledger (FIFO) · เคลม → CN (109)</p>
        </div>
        <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Left: Pools + Claims */}
        <div className="w-full lg:max-w-md flex flex-col border-r border-gray-200 overflow-y-auto p-4 space-y-5">
          <div>
            <h2 className="text-xs font-bold uppercase text-gray-400 mb-2">Rebate Pools</h2>
            {pools.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">ยังไม่มี pool (สร้างเมื่อ confirm SO)</p>
            ) : pools.map(p => {
              const avail = Number(p.AccruedAmt) - Number(p.ClaimedAmt);
              const isSel = selectedPool?.Id === p.Id;
              return (
                <div key={p.Id} onClick={() => openPool(p)}
                  className={`p-3 rounded-xl border cursor-pointer mb-2 transition-all ${isSel ? 'border-blue-700 bg-white shadow-md' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-gray-700">{p.SalesName}</span>
                    <span className="text-xs text-gray-400">{monthLabel(p)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-[10px] text-gray-400">สะสม</div><div className="text-xs font-bold text-gray-600">฿{Number(p.AccruedAmt).toLocaleString('th-TH',{maximumFractionDigits:0})}</div></div>
                    <div><div className="text-[10px] text-gray-400">เคลม</div><div className="text-xs font-bold text-gray-400">฿{Number(p.ClaimedAmt).toLocaleString('th-TH',{maximumFractionDigits:0})}</div></div>
                    <div><div className="text-[10px] text-gray-400">ใช้ได้</div><div className="text-xs font-bold" style={{color:'#059669'}}>฿{avail.toLocaleString('th-TH',{maximumFractionDigits:0})}</div></div>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase text-gray-400 mb-2">เคลมล่าสุด</h2>
            {claims.length === 0 ? (
              <p className="text-xs text-gray-400 py-3 text-center">ยังไม่มีเคลม</p>
            ) : claims.slice(0, 10).map(c => (
              <div key={c.Id} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-gray-100 mb-1.5">
                <div>
                  <div className="text-xs font-bold text-gray-700">฿{Number(c.ClaimAmt).toLocaleString('th-TH',{maximumFractionDigits:0})}</div>
                  <div className="text-[10px] text-gray-400">{c.SalesName} {c.CnDocuNo ? `· CN ${c.CnDocuNo}` : ''}</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${c.Status==='APPROVED'?'bg-green-50 text-green-700':'bg-amber-50 text-amber-700'}`}>
                  {c.Status === 'APPROVED' ? 'อนุมัติ' : 'รออนุมัติ'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Ledger of selected pool */}
        <div className="hidden lg:flex flex-1 flex-col overflow-hidden bg-white">
          {selectedPool ? (
            <>
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-gray-800">{selectedPool.SalesName} · {monthLabel(selectedPool)}</h2>
                  <p className="text-xs text-gray-400">Ledger FIFO — ตัดจากรายการเก่าสุดก่อน</p>
                </div>
                {(role === 'SALES' || role === 'ACCOUNTING' || role === 'ADMIN') && (
                  <button onClick={() => setShowClaim(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-semibold" style={{ background: '#0C447C' }}>
                    <Scissors size={13} /> ยื่นเคลม (FIFO)
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left py-2">สินค้า</th>
                      <th className="text-right py-2">ตัน</th>
                      <th className="text-right py-2">รีเบท/ตัน</th>
                      <th className="text-right py-2">ยอดรีเบท</th>
                      <th className="text-right py-2">คงเหลือ</th>
                      <th className="text-center py-2">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ledger.map(l => (
                      <tr key={l.Id}>
                        <td className="py-2 text-gray-700">{l.GoodCode}</td>
                        <td className="py-2 text-right tabular-nums text-gray-600">{Number(l.QtyTon).toFixed(2)}</td>
                        <td className="py-2 text-right tabular-nums text-gray-600">฿{Number(l.RebatePerTon).toLocaleString()}</td>
                        <td className="py-2 text-right tabular-nums text-gray-700">฿{Number(l.RebateAmount).toLocaleString('th-TH',{maximumFractionDigits:0})}</td>
                        <td className="py-2 text-right tabular-nums font-bold" style={{color: Number(l.RemainingAmt)>0?'#059669':'#9CA3AF'}}>฿{Number(l.RemainingAmt).toLocaleString('th-TH',{maximumFractionDigits:0})}</td>
                        <td className="py-2 text-center">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${l.Status==='CLAIMED'?'bg-gray-100 text-gray-500':'bg-blue-50 text-blue-700'}`}>{l.Status}</span>
                        </td>
                      </tr>
                    ))}
                    {ledger.length === 0 && (
                      <tr><td colSpan={6} className="py-8 text-center text-gray-300">ไม่มีรายการใน pool นี้</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
              <Coins size={56} className="mb-3" />
              <p className="text-sm">เลือก pool เพื่อดู ledger</p>
            </div>
          )}
        </div>
      </div>

      {showClaim && selectedPool && (
        <ClaimDialog pool={selectedPool} onClose={() => setShowClaim(false)}
          onDone={() => { setShowClaim(false); load(); openPool(selectedPool); }} />
      )}
    </div>
  );
}

function ClaimDialog({ pool, onClose, onDone }: { pool: RebatePool; onClose: () => void; onDone: () => void }) {
  const available = Number(pool.AccruedAmt) - Number(pool.ClaimedAmt);
  const [amt, setAmt] = useState(available);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (amt <= 0 || amt > available) { setErr(`ยอดต้องอยู่ระหว่าง 1 - ${available.toFixed(0)}`); return; }
    setBusy(true); setErr('');
    try {
      await createRebateClaim({ poolId: pool.Id, claimAmt: amt });
      onDone();
    } catch (e: unknown) { setErr((e as Error).message || 'ผิดพลาด'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Scissors size={18} /> ยื่นเคลมรีเบท
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between text-gray-500">
            <span>{pool.SalesName} · {pool.PeriodMonth}/{pool.PeriodYear}</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
            <span className="text-xs text-gray-500">ใช้ได้</span>
            <span className="font-bold" style={{ color: '#059669' }}>฿{available.toLocaleString('th-TH',{maximumFractionDigits:0})}</span>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">ยอดที่ขอเคลม (บาท)</label>
            <input type="number" min={1} max={available} value={amt}
              onChange={e => setAmt(parseFloat(e.target.value) || 0)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <ArrowRight size={12} /> ระบบจะตัดยอดแบบ FIFO จากรายการเก่าสุดก่อน
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <button disabled={busy} onClick={submit}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: '#0C447C' }}>
            {busy ? 'กำลังบันทึก...' : 'ยืนยันเคลม'}
          </button>
        </div>
      </div>
    </div>
  );
}
