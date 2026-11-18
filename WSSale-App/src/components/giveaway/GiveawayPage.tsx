import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Gift, RefreshCw, Plus, X, AlertTriangle, Package, ChevronLeft, Search, Link2, UserCheck } from 'lucide-react';
import {
  fetchGiveawayRegions, fetchGiveawayBudgetLines, fetchGiveawayWithdrawals, fetchGiveawayWithdrawalsDateReview,
  fetchGiveawayItems, createGiveawayWithdrawal, fetchGiveawayBorrowRequests, resolveGiveawayBorrowRequest
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { useCan } from '../../utils/capabilities';
import { GiveawayQuotaSettings } from './GiveawayQuotaSettings';
import { SearchableSelect, type SearchableSelectOption } from '../ui/SearchableSelect';
import { formatThaiDate } from '../../utils/date';
import { appAlert, appPrompt, appConfirm } from '../ui/AppAlert';
import type { GiveawayRegion, GiveawayBudgetLine, GiveawayWithdrawal, GiveawayItem } from '../../types';

const TH_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TYPE_LABEL: Record<string, string> = { BAG: 'กระเป๋า(สูตร)', SHIRT: 'เสื้อ', BANNER: 'แบนเนอร์', OTHER: 'อื่นๆ' };

export function GiveawayPage() {
  const role = useAuthStore(s => s.user?.role);
  const canWithdraw = ['SALES', 'COUNTER_SALES', 'ADMIN', 'MANAGER', 'APPROVER', 'C_LEVEL'].includes(role || '');
  const [regions, setRegions]   = useState<GiveawayRegion[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<GiveawayRegion | null>(null);
  const [lines, setLines]       = useState<GiveawayBudgetLine[]>([]);
  const [log, setLog]           = useState<GiveawayWithdrawal[]>([]);
  const [dateReview, setDateReview] = useState<GiveawayWithdrawal[] | null>([]);
  const detailRequest = useRef(0);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<'budget' | 'log' | 'requests' | 'settings'>('budget');
  const can = useCan();
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
    const requestId = ++detailRequest.current;
    setSelected(r);
    setLines([]); setLog([]); setDateReview([]);
    try {
      const [bl, wl, uncertain] = await Promise.all([
        fetchGiveawayBudgetLines(r.Region, undefined, {
          salesUserId: r.SalesUserId ?? undefined,
          regionCode: r.RegionCode ?? undefined,
        }),
        fetchGiveawayWithdrawals(r.Region, undefined, r.SalesUserId ?? undefined),
        fetchGiveawayWithdrawalsDateReview(r.Region, undefined, r.SalesUserId ?? undefined).catch(() => null),
      ]);
      if (detailRequest.current !== requestId) return;
      setLines(bl); setLog(wl); setDateReview(uncertain);
    } catch (e) {
      if (detailRequest.current !== requestId) return;
      console.error(e); setLines([]); setLog([]); setDateReview(null);
    }
  }, []);

  const groupedRegions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = !q
      ? regions
      : regions.filter(r =>
          [
            r.Region,
            r.RegionLabel,
            r.RegionCode,
            r.DisplayName,
            r.EmpName,
            r.EmpCode,
            r.PositionName,
            r.PositionCode,
            r.OrgUnit,
          ]
            .filter(Boolean)
            .some(v => String(v).toLowerCase().includes(q))
        );
    return Object.entries(
      filtered.reduce((acc, r) => {
        const groupKey = r.RegionCode ? `${r.RegionLabel || r.Region} [${r.RegionCode}]` : (r.RegionLabel || r.Region);
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(r);
        return acc;
      }, {} as Record<string, GiveawayRegion[]>)
    );
  }, [regions, searchTerm]);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <Gift className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> ของแถม (Giveaway)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">งบส่งเสริมการขายรายเขต & พนักงานขายตามผังองค์กร ปี 2569 · ผูกข้อมูลหลัก 98 รายการ</p>
        </div>
        <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Region / Org roster sidebar */}
        <div className={`${selected ? 'hidden lg:block' : 'w-full'} lg:w-full lg:max-w-xs border-r border-gray-200 overflow-y-auto p-4`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold uppercase text-gray-400">เขตการขาย / พนักงาน ({regions.length})</h2>
          </div>
          <div className="relative mb-3">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="ค้นหาภาค / พนักงาน / ตำแหน่ง..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-[#0C447C]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {groupedRegions.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">ไม่พบข้อมูลเขตการขายหรือพนักงานที่ตรงกัน</p>
          ) : groupedRegions.map(([regionLabel, items]) => (
            <div key={regionLabel} className="mb-4">
              <h3 className="text-[11px] font-black uppercase text-gray-500 mb-2 tracking-wider px-1 border-l-2 border-[#0C447C] pl-2">{regionLabel}</h3>
              <div className="space-y-2">
                {items.map(r => {
                  const isSel =
                    selected?.SalesUserId != null && r.SalesUserId != null
                      ? selected.SalesUserId === r.SalesUserId && selected.Region === r.Region
                      : selected?.Region === r.Region && selected?.EmpCode === r.EmpCode;
                  const pct = r.TotalBudget ? (r.TotalWithdrawn / r.TotalBudget) * 100 : 0;
                  const empDisplay = r.DisplayName || r.EmpName || r.EmpCode || 'งบส่วนกลางประจำภาค';
                  const noQuotaYet = r.HasQuota === false || Number(r.ItemCount || 0) === 0;
                  
                  return (
                    <div key={`${r.RegionCode || r.Region}-${r.SalesUserId ?? r.EmpCode ?? 'region'}`} onClick={() => openRegion(r)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${isSel ? 'border-blue-700 bg-blue-50 shadow-md' : 'border-gray-100 bg-white hover:border-blue-300'}`}>
                      <div className="flex items-start justify-between gap-1.5 mb-0.5">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[#0C447C] truncate">{empDisplay}</div>
                          {(r.PositionName || r.EmpCode) && (
                            <div className="text-[10px] text-gray-500 truncate mt-0.5">
                              {[r.PositionName, r.EmpCode ? `รหัส ${r.EmpCode}` : null].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {r.OverCount > 0 && (
                            <span 
                              title={`เกิน ${r.OverCount} รายการ รวม ${Number(r.OverQty || 0).toLocaleString()} ชิ้น`}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-bold whitespace-nowrap"
                            >
                              เกิน {Number(r.OverQty || 0).toLocaleString()} ชิ้น
                            </span>
                          )}
                          {noQuotaYet && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold whitespace-nowrap">
                              ยังไม่ตั้งโควต้า
                            </span>
                          )}
                        </div>
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
              <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <button onClick={() => setSelected(null)} className="lg:hidden p-1.5 mr-1 -ml-2 text-gray-500 rounded-lg hover:bg-gray-100">
                    <ChevronLeft size={20} />
                  </button>
                  <button onClick={() => setTab('budget')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab==='budget'?'text-white':'text-gray-500 hover:bg-gray-100'}`} style={tab==='budget'?{background:'#0C447C'}:{}}>งบ + คงเหลือ</button>
                  <button onClick={() => setTab('log')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab==='log'?'text-white':'text-gray-500 hover:bg-gray-100'}`} style={tab==='log'?{background:'#0C447C'}:{}}>ประวัติเบิก ({log.length})</button>
                  <button onClick={() => setTab('requests')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab==='requests'?'text-white':'text-gray-500 hover:bg-gray-100'}`} style={tab==='requests'?{background:'#0C447C'}:{}}>คำขอยืม ({requests.filter(r => r.Status === 'PENDING').length})</button>
                  {can('giveaway.budget') && (
                    <button onClick={() => setTab('settings')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab==='settings'?'text-white':'text-gray-500 hover:bg-gray-100'}`} style={tab==='settings'?{background:'#0C447C'}:{}}>ตั้งค่าโควต้า</button>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                    <UserCheck size={13} className="text-[#0C447C]" />
                    <span className="font-semibold">{selected.DisplayName || selected.EmpName || 'ส่วนกลางภาค'}</span>
                    <span className="text-slate-400">·</span>
                    <span>{selected.Region}</span>
                    {selected.PositionName && <span className="text-slate-400 text-[11px]">({selected.PositionName})</span>}
                  </div>
                  {canWithdraw && (
                    <button onClick={() => setShowWd(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-semibold" style={{ background: '#0C447C' }}>
                      <Plus size={14} /> บันทึกการเบิก
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {tab === 'budget' ? (
                  <table className="w-full text-xs min-w-full">
                    <thead className="whitespace-nowrap">
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left py-2 whitespace-nowrap">ตรา</th>
                        <th className="text-left py-2 whitespace-nowrap">รหัส / รายการสินค้า (98 รายการ)</th>
                        <th className="text-left py-2 whitespace-nowrap">ผู้ถือโควต้า</th>
                        <th className="text-right py-2 whitespace-nowrap">งบ</th>
                        <th className="text-right py-2 whitespace-nowrap">เบิกแล้ว</th>
                        <th className="text-right py-2 whitespace-nowrap">คงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {lines.map(l => {
                        const over = Number(l.RemainingQty) < 0;
                        const labelName = l.GoodName || l.ItemName;
                        return (
                          <tr key={l.Id} className={over ? 'bg-red-50/40' : ''}>
                            <td className="py-2 text-gray-500 whitespace-nowrap">{l.Brand}</td>
                            <td className="py-2 text-gray-700">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {l.GoodCode && (
                                  <span className="inline-flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-[#0C447C] border border-blue-100">
                                    <Link2 size={10} /> {l.GoodCode}
                                  </span>
                                )}
                                <span className="font-medium">{labelName}</span>
                              </div>
                            </td>
                            <td className="py-2 text-gray-500 whitespace-nowrap">
                              {l.SalesUserName || <span className="text-gray-400 italic">ส่วนกลางภาค</span>}
                            </td>
                            <td className="py-2 text-right tabular-nums text-gray-600 whitespace-nowrap">{Number(l.BudgetQty).toLocaleString()}</td>
                            <td className="py-2 text-right tabular-nums text-gray-600 whitespace-nowrap">{Number(l.WithdrawnQty).toLocaleString()}</td>
                            <td className={`py-2 text-right tabular-nums font-bold whitespace-nowrap ${over ? 'text-red-600' : 'text-green-600'}`}>{Number(l.RemainingQty).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                      {lines.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-300 whitespace-nowrap">ยังไม่มีรายการโควต้า — ไปที่แท็บ &quot;ตั้งค่าโควต้า&quot; เพื่อเพิ่มจากรายการของแถมหลัก 98 รายการ</td></tr>}
                    </tbody>
                  </table>
                ) : tab === 'log' ? (
                  <div>
                  {dateReview === null && <p role="status" className="mb-3 text-xs text-amber-700">โหลดรายการรอตรวจวันที่ไม่สำเร็จ กรุณาลองเปิดเขตอีกครั้ง</p>}
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
                          <td className="py-2 text-gray-700 whitespace-nowrap">
                            {w.GoodCode && <span className="font-mono text-[10px] mr-1.5 text-[#0C447C]">[{w.GoodCode}]</span>}
                            {w.GoodName || w.ItemName}
                          </td>
                          <td className="py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">{Number(w.Qty).toLocaleString()}</td>
                          <td className="py-2 text-center whitespace-nowrap">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${w.Source==='IMPORT'?'bg-gray-100 text-gray-500':'bg-blue-50 text-blue-700'}`}>{w.Source}</span>
                          </td>
                        </tr>
                      ))}
                      {log.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-300 whitespace-nowrap">ยังไม่มีการเบิก</td></tr>}
                    </tbody>
                  </table>
                  {dateReview && dateReview.length > 0 && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="font-semibold text-amber-800">รอตรวจวันที่ ({dateReview.length} รายการที่โหลด)</p>
                    <p className="mt-1 text-xs text-amber-800">ข้อมูลมีเพียงปีและเดือน จึงยังระบุไม่ได้ว่าอยู่ก่อนหรือหลังวันเริ่มข้อมูล แสดงสูงสุด 300 รายการ; ยอดคงเหลือยังคำนวณรวมรายการเหล่านี้</p>
                    <ul className="mt-2 space-y-1 text-xs text-amber-900">
                      {dateReview.map(w => <li key={w.Id}>#{w.Id} · {(w.IssueMonth != null && TH_MONTHS[w.IssueMonth]) || 'เดือนผิดปกติหรือไม่ระบุ'} · {w.GoodName || w.ItemName} · {Number(w.Qty).toLocaleString()} · {w.Source}</li>)}
                    </ul>
                  </div>}
                  </div>
                ) : tab === 'settings' && selected ? (
                  <GiveawayQuotaSettings
                    region={selected.Region}
                    regionCode={selected.RegionCode}
                    selectedSalesUserId={selected.SalesUserId}
                    selectedSalesName={selected.DisplayName || selected.EmpName}
                    empId={selected.EmpId}
                    empCode={selected.EmpCode || undefined}
                    lines={lines}
                    onSaved={() => { load(); openRegion(selected); }}
                  />
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
                          <div className="text-xs text-gray-400">{formatThaiDate(r.RequestedAt, true)}</div>
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
                        {r.Status === 'PENDING' && (r.LenderId === useAuthStore.getState().user?.id || ['ADMIN', 'MANAGER', 'C_LEVEL'].includes(role || '')) && (
                          <div className="mt-4 flex gap-2">
                            <button onClick={async () => {
                              if(await appConfirm('ยืนยันการอนุมัติ? ระบบจะหักโควต้าของคุณไปให้ผู้ขอยืม')) {
                                resolveGiveawayBorrowRequest(r.Id, true).then(() => load()).catch(e => void appAlert(e.message, 'error'));
                              }
                            }} className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-700">อนุมัติให้ยืม</button>
                            <button onClick={async () => {
                              const note = await appPrompt('เหตุผลที่ปฏิเสธ (ไม่บังคับ):');
                              if (note !== null) {
                                resolveGiveawayBorrowRequest(r.Id, false, note).then(() => load()).catch(e => void appAlert(e.message, 'error'));
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
        <WithdrawDialog
          region={selected.Region}
          salesUserId={selected.SalesUserId}
          salesName={selected.DisplayName || selected.EmpName}
          onClose={() => setShowWd(false)}
          onDone={() => { setShowWd(false); load(); openRegion(selected); }}
        />
      )}
    </div>
  );
}

function WithdrawDialog({
  region,
  salesUserId,
  salesName,
  onClose,
  onDone,
}: {
  region: string;
  salesUserId?: number | null;
  salesName?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<GiveawayItem[]>([]);
  const [brandFilter, setBrandFilter] = useState('');
  const [goodId, setGoodId] = useState('');
  const [qty, setQty]     = useState(1);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  useEffect(() => { fetchGiveawayItems().then(setItems).catch(() => {}); }, []);
  const brands = useMemo(() => Array.from(new Set(items.map(i => i.Brand))), [items]);
  const selectedItem = useMemo(
    () => items.find(i => String(i.GoodID || i.Id) === goodId),
    [items, goodId]
  );

  const itemOptions: SearchableSelectOption[] = useMemo(() => {
    const filtered = brandFilter ? items.filter(i => i.Brand === brandFilter) : items;
    return filtered.map(i => {
      const gid = String(i.GoodID || i.Id);
      const name = i.GoodName || i.ItemName;
      return {
        value: gid,
        label: i.GoodCode ? `[${i.GoodCode}] ${name}` : name,
        sublabel: `ตรา: ${i.Brand} · ${TYPE_LABEL[i.ItemType] || i.ItemType} · หน่วย: ${i.Unit || 'ชิ้น'}`,
        badge: i.Brand,
        keywords: `${i.GoodCode || ''} ${name} ${i.ItemName} ${i.Brand}`,
      };
    });
  }, [items, brandFilter]);

  async function submit() {
    if (!selectedItem || qty < 1) { setErr('เลือกรายการของแถมและระบุจำนวนให้ถูกต้อง'); return; }
    setBusy(true); setErr('');
    try {
      const res = await createGiveawayWithdrawal({
        region,
        goodId: String(selectedItem.GoodID || selectedItem.Id),
        goodCode: selectedItem.GoodCode || undefined,
        goodName: selectedItem.GoodName || selectedItem.ItemName,
        brand: selectedItem.Brand,
        itemName: selectedItem.ItemName || selectedItem.GoodName,
        salesUserId: salesUserId ?? undefined,
        qty,
        issueMonth: month,
      });
      if (res.isOverBudget) await appAlert(`⚠ เกินงบ! คงเหลือ ${res.status?.RemainingQty}`, 'warning');
      onDone();
    } catch (e: unknown) { setErr((e as Error).message || 'ผิดพลาด'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#0C447C' }}>
              <Gift size={18} /> บันทึกการเบิก — {region}
            </h2>
            {salesName && (
              <p className="text-xs text-gray-500 mt-0.5">พนักงาน: <span className="font-semibold text-gray-700">{salesName}</span></p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3 text-sm">
          {brands.length > 1 && (
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">กรองตามตรา (ไม่บังคับ)</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setBrandFilter('')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${!brandFilter ? 'bg-[#0C447C] text-white border-[#0C447C]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  ทั้งหมด ({items.length})
                </button>
                {brands.map(b => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBrandFilter(b)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${brandFilter === b ? 'bg-[#0C447C] text-white border-[#0C447C]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">รายการของแถม (ข้อมูลหลัก {items.length} รายการ) *</label>
            <SearchableSelect
              options={itemOptions}
              value={goodId}
              onChange={val => { setGoodId(val); setErr(''); }}
              placeholder="-- ค้นหาชื่อหรือรหัสของแถม --"
              searchPlaceholder="พิมพ์รหัสสินค้า หรือชื่อของแถม..."
              allowClear
            />
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
