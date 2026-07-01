import { useEffect, useState, useCallback } from 'react';
import { FileCheck2, RefreshCw, ChevronRight, ChevronLeft, Search, Calendar, Info, X } from 'lucide-react';
import { fetchCnRebateSummary, fetchCnRebateList, fetchCnRebateDetail } from '../../services/api';
import type { CnRebateSummary, CnRebateRow, CnRebateDetail } from '../../types';

type View = 'summary' | 'list' | 'detail';
const THB = (n: number) => `฿${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`;
const currentYear = new Date().getFullYear() + 543; // Buddhist Era

export function CnRebatePage() {
  const [view, setView]           = useState<View>('summary');
  const [year, setYear]           = useState<number | undefined>(undefined);
  const [summary, setSummary]     = useState<CnRebateSummary[]>([]);
  const [list, setList]           = useState<CnRebateRow[]>([]);
  const [detail, setDetail]       = useState<CnRebateDetail[]>([]);
  const [selSales, setSelSales]   = useState<CnRebateSummary | null>(null);
  const [selCN, setSelCN]         = useState<CnRebateRow | null>(null);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [showInfo, setShowInfo]   = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try { setSummary(await fetchCnRebateSummary({ year })); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, [year]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  async function drillSales(s: CnRebateSummary) {
    setSelSales(s);
    setLoading(true);
    try {
      setList(await fetchCnRebateList({ year, empId: Number(s.EmpID) }));
      setView('list');
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function drillCN(row: CnRebateRow) {
    setSelCN(row);
    setLoading(true);
    try {
      setDetail(await fetchCnRebateDetail(row.SOInvID));
      setView('detail');
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  function goBack() {
    if (view === 'detail') { setView('list'); setSelCN(null); }
    else                   { setView('summary'); setSelSales(null); setList([]); }
  }

  const filteredList = list.filter(r =>
    !search || r.CustName.includes(search) || r.CNDocuNo.includes(search) || r.OrigInvNo.includes(search)
  );

  const totalRebate = summary.reduce((s, r) => s + Number(r.TotalRebate || 0), 0);
  const totalCN     = summary.reduce((s, r) => s + Number(r.CNCount || 0), 0);

  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {view !== 'summary' && (
            <button onClick={goBack} className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50">
              <ChevronLeft size={16} />
            </button>
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
              <FileCheck2 className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
              {view === 'summary' && 'CN Rebate (Winspeed)'}
              {view === 'list'    && `CN ของ ${selSales?.SalesName}`}
              {view === 'detail'  && `${selCN?.CNDocuNo}`}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
              {view === 'summary' && 'ใบลดหนี้ rebate จาก dbo.SOInvHD · DocuType=109 · CNRemarkType=ส่วนลดลูกค้า'}
              {view === 'list'    && `${list.length} CN · คลิกเพื่อดูรายการสินค้า`}
              {view === 'detail'  && `${selCN?.CustName} · Orig: ${selCN?.OrigInvNo}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInfo(true)} className="h-10 w-10 flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600">
            <Info size={18} />
          </button>
          {/* Year filter */}
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <Calendar size={14} className="text-gray-400" />
            <select value={year ?? ''} onChange={e => setYear(e.target.value ? Number(e.target.value) : undefined)}
              className="text-sm bg-transparent border-0 outline-none text-gray-700 pr-1">
              <option value="">ทุกปี</option>
              {yearOptions.map(y => (
                <option key={y} value={y - 543}>{y}</option>
              ))}
            </select>
          </div>
          <button onClick={loadSummary} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 sm:space-y-4 min-h-0">

        {/* ── SUMMARY ── */}
        {view === 'summary' && (
          <>
            {/* KPI cards */}
            <div className="bg-white rounded-none sm:rounded-xl border-y sm:border border-gray-100 shadow-sm p-4 text-center sm:text-left flex flex-col items-center sm:items-start min-w-0 shrink-0">
              <div className="text-xs text-gray-400 mb-1">รวม CN rebate ทั้งหมด</div>
              <div className="text-2xl font-bold" style={{ color: '#0C447C' }}>{THB(totalRebate)}</div>
              <div className="text-xs text-gray-400 mt-1">{totalCN} ใบ · {summary.length} พนักงานขาย</div>
            </div>

            {/* Summary table */}
            <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-700">สรุปต่อพนักงานขาย</h2>
                <p className="text-xs text-gray-400 mt-0.5">คลิกเพื่อดูรายการ CN</p>
              </div>
              {loading ? (
                <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
              ) : summary.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-400">ไม่พบข้อมูล CN rebate{year ? ` ปี ${year + 543}` : ''}</p>
              ) : (
                <div className="overflow-auto w-full h-full pb-2">
                  <table className="w-full text-sm text-left min-w-full">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                      <tr>
                        <th className="px-5 py-3 text-left whitespace-nowrap">พนักงานขาย</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">จำนวน CN</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">ลูกค้า</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">รวม rebate</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">ล่าสุด</th>
                        <th className="px-4 py-3 whitespace-nowrap"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {summary.map(s => {
                        const pct = totalRebate ? (Number(s.TotalRebate) / totalRebate) * 100 : 0;
                        return (
                          <tr key={s.EmpID} onClick={() => drillSales(s)} className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                            <td className="px-5 py-3 whitespace-nowrap">
                              <div className="font-semibold text-gray-800">{s.SalesName}</div>
                              <div className="h-1.5 w-28 bg-gray-100 rounded-full mt-1 overflow-hidden">
                                <div className="h-full bg-[#0C447C] rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap">{s.CNCount}</td>
                            <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap">{s.CustCount}</td>
                            <td className="px-4 py-3 text-right font-bold whitespace-nowrap" style={{ color: '#0C447C' }}>{THB(s.TotalRebate)}</td>
                            <td className="px-4 py-3 text-center text-xs text-gray-400 whitespace-nowrap">{s.LastCN?.substring(0,10)}</td>
                            <td className="px-4 py-3 whitespace-nowrap"><ChevronRight size={16} className="text-gray-300 ml-auto" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200 text-sm font-bold">
                      <tr>
                        <td className="px-5 py-3 text-gray-600 whitespace-nowrap">รวม</td>
                        <td className="px-4 py-3 text-center text-gray-600 whitespace-nowrap">{totalCN}</td>
                        <td className="px-4 py-3 whitespace-nowrap"></td>
                        <td className="px-4 py-3 text-right whitespace-nowrap" style={{ color: '#0C447C' }}>{THB(totalRebate)}</td>
                        <td colSpan={2} className="whitespace-nowrap"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── CN LIST ── */}
        {view === 'list' && (
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden flex-1 grid grid-rows-[auto_1fr_auto] min-h-0">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
              <Search size={14} className="text-gray-400" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหาลูกค้า / เลข CN / เลข INV..."
                className="flex-1 text-sm outline-none bg-transparent text-gray-700 placeholder-gray-300"
              />
            </div>
            {loading ? (
              <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
            ) : (
              <div className="overflow-auto w-full h-full pb-2">
              <table className="w-full text-sm text-left min-w-full">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                    <tr>
                      <th className="px-4 py-3 text-left whitespace-nowrap">เลข CN</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">วันที่</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">ลูกค้า</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">INV อ้างอิง</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">ยอด CN</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">สถานะ</th>
                      <th className="px-4 py-3 whitespace-nowrap"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredList.map(row => (
                      <tr key={row.SOInvID} onClick={() => drillCN(row)} className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs font-bold text-[#0C447C] whitespace-nowrap">{row.CNDocuNo}</td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-400 whitespace-nowrap">{row.CNDate}</td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate" title={row.CustName}>{row.CustName}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{row.OrigInvNo}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-800 whitespace-nowrap">{THB(row.CNAmt)}</td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          {Number(row.RemaAmnt) > 0 ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">
                              คงค้าง {THB(row.RemaAmnt)}
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold">
                              ชำระแล้ว
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap"><ChevronRight size={16} className="text-gray-300 ml-auto" /></td>
                      </tr>
                    ))}
                    {filteredList.length === 0 && (
                      <tr><td colSpan={7} className="py-10 text-center text-gray-300 text-sm whitespace-nowrap">ไม่พบรายการ</td></tr>
                    )}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-100">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-xs font-bold text-gray-500 text-right whitespace-nowrap">รวม {filteredList.length} ใบ</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-700 whitespace-nowrap">
                        {THB(filteredList.reduce((s, r) => s + Number(r.CNAmt), 0))}
                      </td>
                      <td colSpan={2} className="whitespace-nowrap"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── DETAIL ── */}
        {view === 'detail' && selCN && (
          <>
            {/* CN header card */}
            <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-5 grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">เลข CN</span>
                  <span className="font-mono font-bold text-[#0C447C]">{selCN.CNDocuNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">วันที่</span>
                  <span className="text-gray-700">{selCN.CNDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">ลูกค้า</span>
                  <span className="text-gray-700 text-right max-w-[200px]">{selCN.CustName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">พนักงานขาย</span>
                  <span className="text-gray-700">{selCN.SalesName}</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">INV อ้างอิง</span>
                  <span className="font-mono text-gray-600">{selCN.OrigInvNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">วันที่ INV</span>
                  <span className="text-gray-600">{selCN.OrigInvDate || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">เหตุผล CN</span>
                  <span className="text-gray-600 text-right max-w-[200px] text-xs">{selCN.Reason}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">สถานะ</span>
                  {Number(selCN.RemaAmnt) > 0 ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">คงค้าง {THB(selCN.RemaAmnt)}</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold">ชำระแล้ว</span>
                  )}
                </div>
              </div>
            </div>

            {/* CN lines */}
            <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-700">รายการสินค้า · ยอด rebate</h2>
              </div>
              {loading ? (
                <div className="py-10 flex justify-center"><RefreshCw size={20} className="animate-spin text-gray-300" /></div>
              ) : (
                <div className="overflow-x-auto pb-2">
                  <table className="w-full text-sm min-w-full">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                      <tr>
                        <th className="px-5 py-3 text-left whitespace-nowrap">สินค้า</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">ราคาขาย (INV)</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">Rebate/ตัน</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">จำนวน (ตัน)</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">รวม Rebate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {detail.map(d => (
                        <tr key={d.ListNo} className="hover:bg-gray-50/50">
                          <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{d.GoodName}</td>
                          <td className="px-4 py-3 text-right text-gray-500 tabular-nums whitespace-nowrap">
                            {d.OrigPrice ? THB(d.OrigPrice) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right text-amber-600 font-semibold tabular-nums whitespace-nowrap">
                            {THB(d.RebatePerTon)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600 tabular-nums whitespace-nowrap">
                            {Number(d.QtyTon).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap" style={{ color: '#0C447C' }}>
                            {THB(d.RebateAmt)}
                          </td>
                        </tr>
                      ))}
                      {detail.length === 0 && (
                        <tr><td colSpan={5} className="py-8 text-center text-gray-300 whitespace-nowrap">ไม่มีรายการสินค้า</td></tr>
                      )}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={3} className="px-5 py-3 text-xs font-bold text-gray-500 text-right whitespace-nowrap">รวม</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-600 tabular-nums whitespace-nowrap">
                          {detail.reduce((s, d) => s + Number(d.QtyTon), 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap" style={{ color: '#0C447C' }}>
                          {THB(detail.reduce((s, d) => s + Number(d.RebateAmt), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowInfo(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2 text-amber-600">
                <Info size={20} /> ข้อมูล CN รีเบท
              </h2>
              <button onClick={() => setShowInfo(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="text-sm text-gray-600 space-y-3">
              <p><strong>Single source of truth:</strong> ข้อมูลนี้ดึงตรงจาก Winspeed</p>
              <p><strong>CN ที่ออกแล้ว (DocuStatus=Y)</strong><br/>= cleared ทั้งหมด</p>
              <p><strong>CN ที่ยังค้างอยู่</strong><br/>= RemaAmnt &gt; 0</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
