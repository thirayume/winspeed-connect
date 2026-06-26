import { useEffect, useState, useCallback } from 'react';
import { Ticket, RefreshCw, ChevronRight, ChevronLeft, Users, Package } from 'lucide-react';
import { fetchVoucherSummary, fetchCouponCustomers, fetchCouponDetail } from '../../services/api';
import type { VoucherSummary, CouponCustomer, CouponRow } from '../../types';

type View = 'summary' | 'customer' | 'coupon';

export function VoucherPage() {
  const [summary, setSummary]     = useState<VoucherSummary[]>([]);
  const [customers, setCustomers] = useState<CouponCustomer[]>([]);
  const [coupons, setCoupons]     = useState<CouponRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [view, setView]           = useState<View>('summary');
  const [selEmp, setSelEmp]       = useState<VoucherSummary | null>(null);
  const [selCust, setSelCust]     = useState<CouponCustomer | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSummary(await fetchVoucherSummary()); }
    catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function drillEmp(emp: VoucherSummary) {
    setSelEmp(emp);
    setLoading(true);
    try {
      setCustomers(await fetchCouponCustomers({ empId: Number(emp.EmpID) }));
      setView('customer');
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function drillCust(cust: CouponCustomer) {
    setSelCust(cust);
    setLoading(true);
    try {
      setCoupons(await fetchCouponDetail(cust.CustID));
      setView('coupon');
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  function goBack() {
    if (view === 'coupon') { setView('customer'); setSelCust(null); }
    else { setView('summary'); setSelEmp(null); setCustomers([]); }
  }

  const totalTon  = summary.reduce((s, r) => s + Number(r.OutstandingTon || 0), 0);
  const totalCust = summary.reduce((s, r) => s + Number(r.CustCount || 0), 0);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          {view !== 'summary' && (
            <button onClick={goBack} className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50">
              <ChevronLeft size={16} />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
              <Ticket size={26} />
              {view === 'summary' && 'Voucher คงค้าง'}
              {view === 'customer' && `ลูกค้าของ ${selEmp?.EmpName}`}
              {view === 'coupon'   && `Voucher ของ ${selCust?.CustName}`}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {view === 'summary'  && 'ยอด Voucher คงค้างจาก Winspeed (WFCoupon) · แยกตามพนักงานขาย'}
              {view === 'customer' && `${customers.length} ลูกค้า · คลิกเพื่อดูรายการ voucher`}
              {view === 'coupon'   && `${coupons.length} ใบคงค้าง`}
            </p>
          </div>
        </div>
        <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* ── SUMMARY ── */}
        {view === 'summary' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0C447C]/10 text-[#0C447C] flex items-center justify-center shrink-0">
                  <Package size={20} />
                </div>
                <div>
                  <div className="text-xs text-gray-400">คงค้างรวม (ตัน)</div>
                  <div className="text-2xl font-bold text-gray-800">{totalTon.toLocaleString(undefined,{maximumFractionDigits:1})}</div>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Users size={20} />
                </div>
                <div>
                  <div className="text-xs text-gray-400">ลูกค้ามี voucher</div>
                  <div className="text-2xl font-bold text-gray-800">{totalCust}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-700">แยกตามพนักงานขาย</h2>
                <p className="text-xs text-gray-400 mt-0.5">คลิกเพื่อดูลูกค้าในสังกัด</p>
              </div>
              {loading ? (
                <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
              ) : summary.length === 0 ? (
                <p className="text-xs text-gray-400 py-8 text-center">ไม่มี voucher คงค้าง</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {summary.map(emp => {
                    const pct = totalTon ? (Number(emp.OutstandingTon) / totalTon) * 100 : 0;
                    return (
                      <button key={emp.EmpID} onClick={() => drillEmp(emp)}
                        className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/70 transition-colors text-left">
                        <div className="w-9 h-9 rounded-xl bg-[#0C447C]/10 text-[#0C447C] flex items-center justify-center font-bold text-sm shrink-0">
                          {emp.EmpName.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-semibold text-gray-700">{emp.EmpName}</span>
                            <span className="text-sm font-bold text-[#0C447C]">
                              {Number(emp.OutstandingTon).toLocaleString(undefined,{maximumFractionDigits:1})} ตัน
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-[#0C447C]" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-400 shrink-0">
                              {emp.CustCount} ลูกค้า · {emp.CouponCount} ใบ
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={16} className="text-gray-300 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── CUSTOMER LIST ── */}
        {view === 'customer' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-700">ลูกค้าในสังกัด {selEmp?.EmpName}</h2>
              <p className="text-xs text-gray-400 mt-0.5">คลิกเพื่อดูรายการ voucher</p>
            </div>
            {loading ? (
              <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">ลูกค้า</th>
                      <th className="px-4 py-3 text-center">ใบ</th>
                      <th className="px-4 py-3 text-right">คงค้าง (ตัน)</th>
                      <th className="px-4 py-3 text-center">ใบแรก</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {customers.map(c => (
                      <tr key={c.CustID} onClick={() => drillCust(c)} className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{c.CustName}</td>
                        <td className="px-4 py-3 text-center text-gray-500">{c.CouponCount}</td>
                        <td className="px-4 py-3 text-right font-bold text-[#0C447C]">
                          {Number(c.OutstandingTon).toLocaleString(undefined,{maximumFractionDigits:2})}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-gray-400">
                          {c.OldestDate?.substring(0,10) || '-'}
                        </td>
                        <td className="px-4 py-3 text-right"><ChevronRight size={16} className="text-gray-300 ml-auto" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── COUPON DETAIL ── */}
        {view === 'coupon' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-700">{selCust?.CustName}</h2>
              <p className="text-xs text-gray-400 mt-0.5">Sales: {selCust?.EmpName} · voucher ที่ยังไม่ได้เบิก</p>
            </div>
            {loading ? (
              <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">เลข Voucher</th>
                      <th className="px-4 py-3 text-left">เลข SO</th>
                      <th className="px-4 py-3 text-center">วันที่</th>
                      <th className="px-4 py-3 text-left">สินค้า</th>
                      <th className="px-4 py-3 text-right">ออก (ตัน)</th>
                      <th className="px-4 py-3 text-right">เบิกแล้ว</th>
                      <th className="px-4 py-3 text-right">คงเหลือ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {coupons.map(c => (
                      <tr key={c.CouponID} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#0C447C]">{c.CouponNo}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{c.SONo}</td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-400">{c.DocuDate}</td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate" title={c.GoodName}>{c.GoodName}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{Number(c.GoodQty).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                        <td className="px-4 py-2.5 text-right text-gray-400">{Number(c.RedeemedQty).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-green-600">
                          {Number(c.RemaQty).toLocaleString(undefined,{maximumFractionDigits:2})}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-100 text-sm">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-bold text-gray-500">รวม</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-600">
                        {coupons.reduce((s,c)=>s+Number(c.GoodQty),0).toLocaleString(undefined,{maximumFractionDigits:2})}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-400">
                        {coupons.reduce((s,c)=>s+Number(c.RedeemedQty),0).toLocaleString(undefined,{maximumFractionDigits:2})}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-green-600">
                        {coupons.reduce((s,c)=>s+Number(c.RemaQty),0).toLocaleString(undefined,{maximumFractionDigits:2})}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
