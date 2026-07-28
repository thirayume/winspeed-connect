import { useEffect, useState, useCallback } from 'react';
import { Coins, RefreshCw, ArrowLeft, Scissors, X, Info } from 'lucide-react';
import {
  fetchRebatePools, fetchRebateLedger, fetchRebateClaims,
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { RebatePool, RebateLedger, RebateClaim } from '../../types';
import { ClaimDialog, ClaimDetailDialog } from './RebateClaimForm';

const CLAIM_STATUS: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING: 'รอดำเนินการ',
  TIER2_PENDING: 'รอผู้จัดการภาค', TIER3_PENDING: 'รอฝ่ายตลาด', TIER4_PENDING: 'รอกรรมการ',
  APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CN_ISSUED: 'ออกใบลดหนี้',
};
const STATUS_TONE: Record<string, string> = {
  APPROVED: 'bg-green-50 text-green-700', CN_ISSUED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
};

export function RebatePage() {
  const role = useAuthStore(s => s.user?.role);
  const [pools, setPools]       = useState<RebatePool[]>([]);
  const [claims, setClaims]     = useState<RebateClaim[]>([]);
  const [selectedPool, setSelectedPool] = useState<RebatePool | null>(null);
  const [ledger, setLedger]     = useState<RebateLedger[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showClaim, setShowClaim] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

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

  const monthLabel = (p: RebatePool) => `${p.PeriodMonth}/${p.PeriodYear < 2500 ? p.PeriodYear + 543 : p.PeriodYear}`;

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <Coins className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> รีเบท (Rebate)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">ส่วนต่างราคา (฿) · Pool รายเดือน · Ledger FIFO · เคลม → WINSpeed Ref</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInfo(true)} className="h-10 w-10 flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600">
            <Info size={18} />
          </button>
          <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden flex mt-2 lg:mt-4">
          {/* Left: Pools + Claims */}
          <div className={`w-full lg:max-w-md flex flex-col lg:border-r border-gray-200 overflow-y-auto px-4 pb-4 space-y-5 ${selectedPool ? 'hidden lg:flex' : 'flex'}`}>
            <div>
              <h2 className="text-xs font-bold uppercase text-gray-400 mb-2">Rebate Pools (รายเดือน)</h2>
              {pools.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">ยังไม่มี pool</p>
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
                <button key={c.Id} onClick={() => setDetailId(Number(c.Id))} type="button"
                  className="w-full text-left flex items-center justify-between p-2.5 rounded-lg bg-white border border-gray-100 mb-1.5 hover:border-blue-300 hover:bg-blue-50/40 transition">
                  <div>
                    <div className="text-xs font-bold text-gray-700">฿{Number(c.ClaimAmt).toLocaleString('th-TH',{maximumFractionDigits:0})}</div>
                    <div className="text-[10px] text-gray-400">{c.SalesName} {c.CnDocuNo ? `· Ref ${c.CnDocuNo}` : ''}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_TONE[String(c.Status)] || 'bg-amber-50 text-amber-700'}`}>
                    {CLAIM_STATUS[String(c.Status)] || c.Status}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Ledger */}
          <div className={`flex-1 flex-col overflow-hidden bg-white ${selectedPool ? 'flex' : 'hidden lg:flex'}`}>
            {selectedPool ? (
              <>
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1 lg:hidden">
                      <button onClick={() => setSelectedPool(null)} className="p-1 -ml-2 text-gray-500 hover:bg-gray-100 rounded-lg">
                        <ArrowLeft size={20} />
                      </button>
                      <h2 className="font-bold text-gray-800">{selectedPool.SalesName}</h2>
                    </div>
                    <h2 className="font-bold text-gray-800 hidden lg:block">{selectedPool.SalesName} · {monthLabel(selectedPool)}</h2>
                    <p className="text-xs text-gray-400"><span className="lg:hidden">{monthLabel(selectedPool)} · </span>Ledger FIFO — ตัดจากรายการเก่าสุดก่อน</p>
                  </div>
                  {(role === 'SALES' || role === 'ACCOUNTING' || role === 'ADMIN' || role === 'C_LEVEL') && (
                    <button onClick={() => setShowClaim(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-semibold" style={{ background: '#0C447C' }}>
                      <Scissors size={13} /> ยื่นเคลม (FIFO)
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-full">
                      <thead className="whitespace-nowrap">
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left py-2 px-3 whitespace-nowrap">สินค้า</th>
                        <th className="text-right py-2 px-3 whitespace-nowrap">ตัน</th>
                        <th className="text-right py-2 px-3 whitespace-nowrap">รีเบท/ตัน</th>
                        <th className="text-right py-2 px-3 whitespace-nowrap">ยอดรีเบท</th>
                        <th className="text-right py-2 px-3 whitespace-nowrap">คงเหลือ</th>
                        <th className="text-center py-2 px-3 whitespace-nowrap">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {ledger.map(l => (
                        <tr key={l.Id}>
                          <td className="py-2 px-3 whitespace-nowrap text-gray-700">{l.GoodCode}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right tabular-nums text-gray-600">{Number(l.QtyTon).toFixed(2)}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right tabular-nums text-gray-600">฿{Number(l.RebatePerTon).toLocaleString()}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right tabular-nums text-gray-700">฿{Number(l.RebateAmount).toLocaleString('th-TH',{maximumFractionDigits:0})}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-right tabular-nums font-bold" style={{color: Number(l.RemainingAmt)>0?'#059669':'#9CA3AF'}}>฿{Number(l.RemainingAmt).toLocaleString('th-TH',{maximumFractionDigits:0})}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-center">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${l.Status==='CLAIMED'?'bg-gray-100 text-gray-500':'bg-blue-50 text-blue-700'}`}>{l.Status}</span>
                          </td>
                        </tr>
                      ))}
                      {ledger.length === 0 && (
                        <tr><td colSpan={6} className="py-8 text-center text-gray-300 whitespace-nowrap">ไม่มีรายการใน pool นี้</td></tr>
                      )}
                    </tbody>
                  </table>
                  </div>
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
      </div>

      {showClaim && selectedPool && (
        <ClaimDialog pool={selectedPool} onClose={() => setShowClaim(false)}
          onDone={() => { setShowClaim(false); load(); openPool(selectedPool); }} />
      )}

      {detailId != null && (
        <ClaimDetailDialog claimId={detailId} onClose={() => setDetailId(null)}
          onChanged={() => { load(); if (selectedPool) openPool(selectedPool); }} />
      )}

      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowInfo(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2 text-blue-800">
                <Info size={20} /> วิธีทำงาน (Rebate)
              </h2>
              <button onClick={() => setShowInfo(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="text-sm text-gray-600 space-y-3">
              <p>เมื่อ Sales สร้าง SO ผ่าน App และตั้งราคาขาย (Price) สูงกว่าราคาสุทธิ (Net) —</p>
              <div className="bg-blue-50 text-blue-800 p-3 rounded-lg font-mono text-xs border border-blue-100">
                รีเบท = (PricePerTon − NetPricePerTon) × ตัน
                <br/>→ สะสมในบัญชีพนักงาน
              </div>
              <p>ลูกค้าสามารถใช้รีเบทเป็นส่วนลดบิลใดก็ได้ → บัญชีออก CN 109 ลดหนี้ให้ลูกค้า</p>
              <p><strong>Ledger FIFO:</strong> ระบบจะตัดยอดจากรายการเก่าสุดก่อนเสมอ</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
