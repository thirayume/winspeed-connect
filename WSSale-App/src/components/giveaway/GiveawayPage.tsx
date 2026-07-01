import { useEffect, useState, useCallback } from 'react';
import { Gift, RefreshCw, Plus, X, AlertTriangle, Package, ChevronLeft } from 'lucide-react';
import {
  fetchGiveawayRegions, fetchGiveawayBudgetLines, fetchGiveawayWithdrawals,
  fetchGiveawayItems, createGiveawayWithdrawal, fetchGiveawayBorrowRequests, resolveGiveawayBorrowRequest
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { GiveawayRegion, GiveawayBudgetLine, GiveawayWithdrawal, GiveawayItem } from '../../types';

const TH_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TYPE_LABEL: Record<string, string> = { BAG: 'กระเป๋า(สูตร)', SHIRT: 'เสื้อ', BANNER: 'แบนเนอร์', OTHER: 'อื่นๆ' };

export function GiveawayPage() {
  const role = useAuthStore(s => s.user?.role);
  const canWithdraw = role === 'SALES' || role === 'COUNTER_SALES' || role === 'ADMIN';
  const [regions, setRegions]   = useState<GiveawayRegion[]>([]);
  const [selected, setSelected] = useState<GiveawayRegion | null>(null);
  const [lines, setLines]       = useState<GiveawayBudgetLine[]>([]);
  const [log, setLog]           = useState<GiveawayWithdrawal[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<'budget' | 'log' | 'requests'>('budget');
  const [showWd, setShowWd]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { 
      setRegions(await fetchGiveawayRegions());
      setRequests(await fetchGiveawayBorrowRequests());
    }
    catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openRegion = useCallback(async (r: GiveawayRegion) => {
    setSelected(r);
    try {
      const [bl, wl] = await Promise.all([fetchGiveawayBudgetLines(r.Region), fetchGiveawayWithdrawals(r.Region)]);
      setLines(bl); setLog(wl);
    } catch (e) { console.error(e); setLines([]); setLog([]); }
  }, []);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <Gift className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> ของแถม (Giveaway)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">งบส่งเสริมการขายรายภาค ปี 2569 · จำนวนชิ้น ต่อ ตรา × รายการ</p>
        </div>
        <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Region list */}
        <div className={`${selected ? 'hidden lg:block' : 'w-full'} lg:w-full lg:max-w-xs border-r border-gray-200 overflow-y-auto p-4`}>
          <h2 className="text-xs font-bold uppercase text-gray-400 mb-3">ภาค / พนักงาน</h2>
          {regions.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">ไม่มีข้อมูล</p>
          ) : Object.entries(
            regions.reduce((acc, r) => {
              if (!acc[r.Region]) acc[r.Region] = [];
              acc[r.Region].push(r);
              return acc;
            }, {} as Record<string, GiveawayRegion[]>)
          ).map(([regionName, items]) => (
            <div key={regionName} className="mb-4">
              <h3 className="text-[11px] font-black uppercase text-gray-400 mb-2 tracking-wider px-1 border-l-2 border-gray-300 pl-2">{regionName}</h3>
              <div className="space-y-2">
                {items.map(r => {
                  const isSel = selected?.Region === r.Region && selected?.EmpCode === r.EmpCode;
                  const pct = r.TotalBudget ? (r.TotalWithdrawn / r.TotalBudget) * 100 : 0;
                  const empDisplay = r.EmpName || r.EmpCode || 'ไม่ระบุพนักงาน';
                  
                  return (
                    <div key={`${r.Region}-${r.EmpCode}`} onClick={() => openRegion(r)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${isSel ? 'border-blue-700 bg-blue-50 shadow-md' : 'border-gray-100 bg-white hover:border-blue-300'}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-bold text-[#0C447C]">{empDisplay}</span>
                        {r.OverCount > 0 && (
                          <span 
                            title={`เกิน ${r.OverCount} รายการ รวม ${Number(r.OverQty || 0).toLocaleString()} ชิ้น`}
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-bold"
                          >
                            เกิน {Number(r.OverQty || 0).toLocaleString()} ชิ้น
                          </span>
                        )}
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1 mt-2">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%`, background: r.OverCount > 0 ? '#EF4444' : '#0C447C' }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                        <span>เบิก {Number(r.TotalWithdrawn).toLocaleString()} / {Number(r.TotalBudget).toLocaleString()}</span>
                        <span>{r.ItemCount} รายการ</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Detail */}
        <div className={`${!selected ? 'hidden' : 'flex'} lg:flex flex-1 flex-col overflow-hidden bg-white w-full`}>
          {selected ? (
            <>
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between overflow-x-auto">
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <button onClick={() => setSelected(null)} className="lg:hidden p-1.5 mr-1 -ml-2 text-gray-500 rounded-lg hover:bg-gray-100">
                    <ChevronLeft size={20} />
                  </button>
                  <button onClick={() => setTab('budget')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab==='budget'?'text-white':'text-gray-500 hover:bg-gray-100'}`} style={tab==='budget'?{background:'#0C447C'}:{}}>งบ + คงเหลือ</button>
                  <button onClick={() => setTab('log')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab==='log'?'text-white':'text-gray-500 hover:bg-gray-100'}`} style={tab==='log'?{background:'#0C447C'}:{}}>ประวัติเบิก ({log.length})</button>
                  <button onClick={() => setTab('requests')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab==='requests'?'text-white':'text-gray-500 hover:bg-gray-100'}`} style={tab==='requests'?{background:'#0C447C'}:{}}>คำขอยืม ({requests.filter(r => r.Status === 'PENDING').length})</button>
                </div>
                {canWithdraw && (
                  <button onClick={() => setShowWd(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-semibold" style={{ background: '#0C447C' }}>
                    <Plus size={14} /> บันทึกการเบิก
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {tab === 'budget' ? (
                  <table className="w-full text-xs min-w-full">
                    <thead className="whitespace-nowrap">
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left py-2 whitespace-nowrap">ตรา</th>
                        <th className="text-left py-2 whitespace-nowrap">รายการ</th>
                        <th className="text-right py-2 whitespace-nowrap">งบ</th>
                        <th className="text-right py-2 whitespace-nowrap">เบิกแล้ว</th>
                        <th className="text-right py-2 whitespace-nowrap">คงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {lines.map(l => {
                        const over = Number(l.RemainingQty) < 0;
                        return (
                          <tr key={l.Id} className={over ? 'bg-red-50/40' : ''}>
                            <td className="py-2 text-gray-500 whitespace-nowrap">{l.Brand}</td>
                            <td className="py-2 text-gray-700 whitespace-nowrap">{l.ItemName}</td>
                            <td className="py-2 text-right tabular-nums text-gray-600 whitespace-nowrap">{Number(l.BudgetQty).toLocaleString()}</td>
                            <td className="py-2 text-right tabular-nums text-gray-600 whitespace-nowrap">{Number(l.WithdrawnQty).toLocaleString()}</td>
                            <td className={`py-2 text-right tabular-nums font-bold ${over ? 'text-red-600' : 'text-green-600'}`}>{Number(l.RemainingQty).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                      {lines.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-300 whitespace-nowrap">ไม่มีงบ</td></tr>}
                    </tbody>
                  </table>
                ) : tab === 'log' ? (
                  <table className="w-full text-xs min-w-full">
                    <thead className="whitespace-nowrap">
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left py-2 whitespace-nowrap">เดือน</th>
                        <th className="text-left py-2 whitespace-nowrap">ตรา</th>
                        <th className="text-left py-2 whitespace-nowrap">รายการ</th>
                        <th className="text-right py-2 whitespace-nowrap">จ่ายออก</th>
                        <th className="text-center py-2 whitespace-nowrap">ที่มา</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {log.map(w => (
                        <tr key={w.Id}>
                          <td className="py-2 text-gray-500 whitespace-nowrap">{w.IssueMonth ? TH_MONTHS[w.IssueMonth] : '-'}</td>
                          <td className="py-2 text-gray-500 whitespace-nowrap">{w.Brand}</td>
                          <td className="py-2 text-gray-700 whitespace-nowrap">{w.ItemName}</td>
                          <td className="py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">{Number(w.Qty).toLocaleString()}</td>
                          <td className="py-2 text-center whitespace-nowrap">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${w.Source==='IMPORT'?'bg-gray-100 text-gray-500':'bg-blue-50 text-blue-700'}`}>{w.Source}</span>
                          </td>
                        </tr>
                      ))}
                      {log.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-300 whitespace-nowrap">ยังไม่มีการเบิก</td></tr>}
                    </tbody>
                  </table>
                ) : tab === 'requests' ? (
                  <div className="space-y-4">
                    {requests.map(r => (
                      <div key={r.Id} className="border border-gray-200 rounded-lg p-4 shadow-sm bg-white">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${r.Status === 'PENDING' ? 'bg-amber-100 text-amber-700' : r.Status === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {r.Status === 'PENDING' ? 'รออนุมัติ' : r.Status === 'APPROVED' ? 'อนุมัติแล้ว' : 'ปฏิเสธ'}
                            </span>
                            <span className="ml-2 text-sm font-bold text-gray-700">{r.RequesterName} ขอยืมจาก {r.LenderName}</span>
                          </div>
                          <div className="text-xs text-gray-400">{new Date(r.RequestedAt).toLocaleString()}</div>
                        </div>
                        <div className="text-sm mt-2">
                          <span className="font-semibold text-gray-600">รายการ: </span> <span className="text-[#0C447C] font-bold">{r.Brand} - {r.ItemName}</span>
                        </div>
                        <div className="text-sm mt-1">
                          <span className="font-semibold text-gray-600">จำนวน: </span> <span className="text-amber-600 font-bold">{r.Qty} ชิ้น</span>
                        </div>
                        <div className="text-sm mt-1">
                          <span className="font-semibold text-gray-600">เหตุผล: </span> <span className="text-gray-700">{r.Reason}</span>
                        </div>
                        {r.Status === 'PENDING' && (r.LenderId === useAuthStore.getState().user?.id || ['ADMIN', 'MANAGER'].includes(role || '')) && (
                          <div className="mt-4 flex gap-2">
                            <button onClick={() => {
                              if(window.confirm('ยืนยันการอนุมัติ? ระบบจะหักโควต้าของคุณไปให้ผู้ขอยืม')) {
                                resolveGiveawayBorrowRequest(r.Id, true).then(() => load()).catch(e => alert(e.message));
                              }
                            }} className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-700">อนุมัติให้ยืม</button>
                            <button onClick={() => {
                              const note = window.prompt('เหตุผลที่ปฏิเสธ (ไม่บังคับ):');
                              if (note !== null) {
                                resolveGiveawayBorrowRequest(r.Id, false, note).then(() => load()).catch(e => alert(e.message));
                              }
                            }} className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded hover:bg-red-700">ปฏิเสธ</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {requests.length === 0 && <div className="text-center py-8 text-gray-400">ไม่มีคำขอยืมโควต้า</div>}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
              <Package size={56} className="mb-3" />
              <p className="text-sm">เลือกภาคเพื่อดูงบของแถม</p>
            </div>
          )}
        </div>
      </div>

      {showWd && selected && (
        <WithdrawDialog region={selected.Region} onClose={() => setShowWd(false)}
          onDone={() => { setShowWd(false); load(); openRegion(selected); }} />
      )}
    </div>
  );
}

function WithdrawDialog({ region, onClose, onDone }: { region: string; onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState<GiveawayItem[]>([]);
  const [brand, setBrand] = useState('');
  const [itemName, setItemName] = useState('');
  const [qty, setQty]     = useState(1);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  useEffect(() => { fetchGiveawayItems().then(setItems).catch(() => {}); }, []);
  const brands = Array.from(new Set(items.map(i => i.Brand)));
  const itemsForBrand = items.filter(i => i.Brand === brand);

  async function submit() {
    if (!brand || !itemName || qty < 1) { setErr('เลือกตรา รายการ และจำนวน'); return; }
    setBusy(true); setErr('');
    try {
      const res = await createGiveawayWithdrawal({ region, brand, itemName, qty, issueMonth: month });
      if (res.isOverBudget) alert(`⚠ เกินงบ! คงเหลือ ${res.status?.RemainingQty}`);
      onDone();
    } catch (e: unknown) { setErr((e as Error).message || 'ผิดพลาด'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#0C447C' }}><Gift size={18} /> บันทึกการเบิก — {region}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">ตรา *</label>
            <select value={brand} onChange={e => { setBrand(e.target.value); setItemName(''); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">-- เลือก --</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">รายการ *</label>
            <select value={itemName} onChange={e => setItemName(e.target.value)} disabled={!brand} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50">
              <option value="">-- เลือก --</option>
              {itemsForBrand.map(i => <option key={i.Id} value={i.ItemName}>{i.ItemName} ({TYPE_LABEL[i.ItemType]})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">จำนวน (ชิ้น) *</label>
              <input type="number" min={1} value={qty} onChange={e => setQty(parseInt(e.target.value) || 0)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">เดือน</label>
              <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {TH_MONTHS.map((m, i) => i > 0 ? <option key={i} value={i}>{m}</option> : null)}
              </select>
            </div>
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <button disabled={busy} onClick={submit} className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: '#0C447C' }}>
            {busy ? 'กำลังบันทึก...' : 'บันทึกการเบิก'}
          </button>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <AlertTriangle size={12} /> หากเบิกเกินงบ ระบบจะเตือนแต่ยังบันทึก (คงเหลือติดลบ)
          </div>
        </div>
      </div>
    </div>
  );
}
