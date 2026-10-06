import { useEffect, useState, useCallback } from 'react';
import { Ticket, RefreshCw, ChevronRight, ChevronLeft, Users, Package, Clock } from 'lucide-react';
import { fetchVoucherSummary, fetchCouponCustomers, fetchCouponDetail, fetchCouponWorklist } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { VoucherSummary, CouponCustomer, CouponRow, CouponWorklistRow } from '../../types';

function getCouponExpiry(c: { DocuDate?: string; ExpireDate?: string; expiryDate?: string; daysLeft?: number }) {
  if (c.expiryDate) {
    const days = typeof c.daysLeft === 'number'
      ? c.daysLeft
      : Math.ceil((new Date(c.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { expiryDate: c.expiryDate, daysLeft: days };
  }
  if (c.ExpireDate) {
    const exp = new Date(c.ExpireDate);
    const days = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { expiryDate: exp.toISOString().slice(0, 10), daysLeft: days };
  }
  if (c.DocuDate) {
    const docDate = new Date(c.DocuDate);
    const exp = new Date(docDate.getTime() + 180 * 24 * 60 * 60 * 1000);
    const days = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { expiryDate: exp.toISOString().slice(0, 10), daysLeft: days };
  }
  return { expiryDate: '-', daysLeft: 999 };
}

type MainTab = 'worklist' | 'hierarchy';
type HierarchyView = 'summary' | 'customer' | 'coupon';

export function VoucherPage() {
  const { user } = useAuthStore();
  const isSales = user?.role === 'SALES';

  const [activeTab, setActiveTab]       = useState<MainTab>('worklist');
  const [worklist, setWorklist]         = useState<CouponWorklistRow[]>([]);
  const [summary, setSummary]           = useState<VoucherSummary[]>([]);
  const [customers, setCustomers]       = useState<CouponCustomer[]>([]);
  const [coupons, setCoupons]           = useState<CouponRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [hierarchyView, setHierarchyView] = useState<HierarchyView>('summary');
  const [selEmp, setSelEmp]             = useState<VoucherSummary | null>(null);
  const [selCust, setSelCust]           = useState<CouponCustomer | null>(null);
  const [expiryFilter, setExpiryFilter] = useState<'ALL' | 'EXPIRING' | 'EXPIRED'>('ALL');
  const [searchFilter, setSearchFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wlData, sumData] = await Promise.all([
        fetchCouponWorklist().catch(err => { console.error('fetchCouponWorklist error', err); return []; }),
        fetchVoucherSummary().catch(err => { console.error('fetchVoucherSummary error', err); return []; })
      ]);
      setWorklist(wlData);
      setSummary(sumData);

      if (isSales && user?.empId) {
        const myEmp = sumData.find(r => String(r.EmpID) === String(user.empId)) || {
          EmpID: String(user.empId),
          EmpName: user.displayName || 'ฉัน',
          CouponCount: 0,
          OutstandingTon: 0,
          CustCount: 0
        };
        setSelEmp(myEmp);
        const myCustomers = await fetchCouponCustomers({ empId: Number(user.empId) }).catch(() => []);
        setCustomers(myCustomers);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [isSales, user]);

  useEffect(() => { load(); }, [load]);

  async function drillEmp(emp: VoucherSummary) {
    setSelEmp(emp);
    setLoading(true);
    try {
      setCustomers(await fetchCouponCustomers({ empId: Number(emp.EmpID) }));
      setHierarchyView('customer');
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function drillCust(cust: CouponCustomer) {
    setSelCust(cust);
    setLoading(true);
    try {
      setCoupons(await fetchCouponDetail(cust.CustID));
      setActiveTab('hierarchy');
      setHierarchyView('coupon');
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  function goBackHierarchy() {
    if (hierarchyView === 'coupon') {
      setHierarchyView(isSales ? 'customer' : (selEmp ? 'customer' : 'summary'));
      setSelCust(null);
    } else if (!isSales) {
      setHierarchyView('summary');
      setSelEmp(null);
      setCustomers([]);
    }
  }

  const totalTon  = summary.reduce((s, r) => s + Number(r.OutstandingTon || 0), 0);
  const totalCust = summary.reduce((s, r) => s + Number(r.CustCount || 0), 0);

  const filteredWorklist = worklist.filter(w => {
    if (expiryFilter === 'EXPIRED') {
      if (!w.isExpired && w.daysLeft > 0) return false;
    } else if (expiryFilter === 'EXPIRING') {
      if (!w.isExpiringSoon && (w.daysLeft <= 0 || w.daysLeft > 30)) return false;
    }
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      const matchNo = (w.couponNo || '').toLowerCase().includes(q);
      const matchCust = (w.custName || '').toLowerCase().includes(q) || (w.ownerCustCode || '').toLowerCase().includes(q);
      const matchGood = (w.goodName || '').toLowerCase().includes(q);
      const matchBen = (w.beneficiaries || []).some(b => (b.beneficiaryCustName || '').toLowerCase().includes(q) || (b.beneficiaryCustCode || '').toLowerCase().includes(q));
      return matchNo || matchCust || matchGood || matchBen;
    }
    return true;
  });

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {activeTab === 'hierarchy' && hierarchyView !== 'summary' && (
            <button onClick={goBackHierarchy} className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50">
              <ChevronLeft size={16} />
            </button>
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
              <Ticket className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
              {activeTab === 'worklist' && 'ตั๋วปุ๋ยคงค้าง (Near-Expiry Worklist)'}
              {activeTab === 'hierarchy' && hierarchyView === 'summary' && 'Voucher คงค้าง (แยกตามพนักงาน)'}
              {activeTab === 'hierarchy' && hierarchyView === 'customer' && `ลูกค้าของ ${selEmp?.EmpName}`}
              {activeTab === 'hierarchy' && hierarchyView === 'coupon'   && `Voucher ของ ${selCust?.CustName}`}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
              {activeTab === 'worklist' && `พบตั๋วใกล้หมดอายุ/หมดอายุ ${worklist.length} รายการ (ระบบคำนวณอายุและสมาชิกอัตโนมัติ)`}
              {activeTab === 'hierarchy' && hierarchyView === 'summary' && 'ยอด Voucher คงค้างจาก Winspeed (WFCoupon) · แยกตามพนักงานขาย'}
              {activeTab === 'hierarchy' && hierarchyView === 'customer' && `${customers.length} ลูกค้า · คลิกเพื่อดูรายการ voucher`}
              {activeTab === 'hierarchy' && hierarchyView === 'coupon' && `${coupons.length} ใบคงค้าง`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Main navigation switch */}
          <div className="bg-gray-100 p-1 rounded-xl flex items-center gap-1 text-xs font-bold">
            <button
              onClick={() => setActiveTab('worklist')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${activeTab === 'worklist' ? 'bg-[#0C447C] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <Clock size={14} /> ตั๋วใกล้หมดอายุ ({worklist.filter(w => w.isExpiringSoon || (w.daysLeft > 0 && w.daysLeft <= 30)).length})
            </button>
            <button
              onClick={() => { setActiveTab('hierarchy'); if (isSales) setHierarchyView('customer'); }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${activeTab === 'hierarchy' ? 'bg-[#0C447C] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <Users size={14} /> รายชื่อตามสังกัด
            </button>
          </div>

          <button onClick={load} className="h-9 w-9 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={15} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 sm:p-6 space-y-3 sm:space-y-5">

        {/* ── WORKLIST TAB (R9-6: FIRST VIEW) ── */}
        {activeTab === 'worklist' && (
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50">
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  placeholder="ค้นหาเลขตั๋ว, เจ้าของ, สมาชิก, สินค้า..."
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="w-full sm:w-80 px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#0C447C]"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setExpiryFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${expiryFilter === 'ALL' ? 'bg-[#0C447C] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  ทั้งหมด ({worklist.length})
                </button>
                <button
                  type="button"
                  onClick={() => setExpiryFilter('EXPIRING')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${expiryFilter === 'EXPIRING' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
                >
                  ใกล้หมดอายุ ({worklist.filter(w => w.isExpiringSoon || (w.daysLeft > 0 && w.daysLeft <= 30)).length})
                </button>
                <button
                  type="button"
                  onClick={() => setExpiryFilter('EXPIRED')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${expiryFilter === 'EXPIRED' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}
                >
                  หมดอายุแล้ว ({worklist.filter(w => w.isExpired || w.daysLeft <= 0).length})
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
            ) : filteredWorklist.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400">ไม่พบตั๋วปุ๋ยคงค้างที่ตรงตามเงื่อนไข</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-full">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                    <tr>
                      <th className="px-4 py-3 text-left whitespace-nowrap">เลข Voucher</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">เจ้าของตั๋ว</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">สมาชิกที่ได้รับสิทธิ์</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">สินค้า</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">คงเหลือ</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">วันหมดอายุ</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">สถานะอายุ</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredWorklist.map(w => (
                      <tr key={w.couponId} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#0C447C] whitespace-nowrap">
                          {w.couponNo}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="font-medium text-gray-800 text-xs">{w.custName}</div>
                          <div className="text-[10px] text-gray-400 font-mono">
                            รหัส: {w.ownerCustCode || w.custCode || w.custId}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 max-w-[200px]">
                          {w.beneficiaries && w.beneficiaries.length > 0 ? (
                            <div className="space-y-0.5">
                              {w.beneficiaries.map((b, idx) => {
                                const benName = b.beneficiaryCustName || (b as any).BeneficiaryCustName || b.beneficiaryCustCode || (b as any).BeneficiaryCustCode || b.beneficiaryCustId || (b as any).BeneficiaryCustId;
                                const benCode = b.beneficiaryCustCode || (b as any).BeneficiaryCustCode;
                                return (
                                  <span key={idx} className="inline-block bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-[10px] mr-1 mb-1 font-medium">
                                    {benName}{benCode && benCode !== benName ? ` (${benCode})` : ''}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[180px] truncate text-xs" title={w.goodName}>
                          {w.goodName}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-700 whitespace-nowrap text-xs">
                          {Number(w.remaQty).toFixed(2)} ตัน
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-500 whitespace-nowrap font-mono">
                          {w.expiryDate}
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          {w.daysLeft <= 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                              ⚠️ หมดอายุแล้ว
                            </span>
                          ) : w.daysLeft <= 30 ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              ⏳ เหลือ {w.daysLeft} วัน
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                              เหลือ {w.daysLeft} วัน
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => drillCust({
                              CustID: String(w.custId),
                              CustName: w.custName,
                              EmpID: '',
                              EmpName: '',
                              CouponCount: 0,
                              OutstandingTon: w.remaQty,
                              OldestDate: w.docuDate
                            })}
                            className="px-2 py-1 text-[11px] font-bold text-[#0C447C] bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200"
                          >
                            ดูตั๋วทั้งหมด
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── HIERARCHY TAB ── */}
        {activeTab === 'hierarchy' && hierarchyView === 'summary' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0C447C]/10 text-[#0C447C] flex items-center justify-center shrink-0">
                  <Package size={20} />
                </div>
                <div>
                  <div className="text-xs text-gray-400">คงค้างรวม (ตัน)</div>
                  <div className="text-2xl font-bold text-gray-800">{totalTon.toLocaleString(undefined,{maximumFractionDigits:1})}</div>
                </div>
              </div>
              <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Users size={20} />
                </div>
                <div>
                  <div className="text-xs text-gray-400">ลูกค้ามี voucher</div>
                  <div className="text-2xl font-bold text-gray-800">{totalCust}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
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
        {activeTab === 'hierarchy' && hierarchyView === 'customer' && (
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-700">ลูกค้าในสังกัด {selEmp?.EmpName}</h2>
              <p className="text-xs text-gray-400 mt-0.5">คลิกเพื่อดูรายการ voucher</p>
            </div>
            {loading ? (
              <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-full">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                    <tr>
                      <th className="px-4 py-3 text-left whitespace-nowrap">ลูกค้า</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">ใบ</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">คงค้าง (ตัน)</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">ใบแรก</th>
                      <th className="px-4 py-3 whitespace-nowrap"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {customers.map(c => (
                      <tr key={c.CustID} onClick={() => drillCust(c)} className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{c.CustName}</td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">{c.CouponCount}</td>
                        <td className="px-4 py-3 text-right font-bold text-[#0C447C] whitespace-nowrap">
                          {Number(c.OutstandingTon).toLocaleString(undefined,{maximumFractionDigits:2})}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-gray-400 whitespace-nowrap">
                          {c.OldestDate?.substring(0,10) || '-'}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap"><ChevronRight size={16} className="text-gray-300 ml-auto" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── COUPON DETAIL (WITH MEMBERS / BENEFICIARIES R9-6) ── */}
        {activeTab === 'hierarchy' && hierarchyView === 'coupon' && (
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-gray-700">{selCust?.CustName}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Sales: {selCust?.EmpName || '—'} · voucher ที่ยังไม่ได้เบิก</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setExpiryFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${expiryFilter === 'ALL' ? 'bg-[#0C447C] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  ทั้งหมด ({coupons.length})
                </button>
                <button
                  type="button"
                  onClick={() => setExpiryFilter('EXPIRING')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${expiryFilter === 'EXPIRING' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
                >
                  ใกล้หมดอายุ
                </button>
                <button
                  type="button"
                  onClick={() => setExpiryFilter('EXPIRED')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${expiryFilter === 'EXPIRED' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}
                >
                  หมดอายุแล้ว
                </button>
              </div>
            </div>
            {loading ? (
              <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-full">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                    <tr>
                      <th className="px-4 py-3 text-left whitespace-nowrap">เลข Voucher</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">เลข SO</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">วันที่</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">สินค้า / สมาชิก</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">ออก (ตัน)</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">เบิกแล้ว</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">คงเหลือ</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">วันหมดอายุ</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">สถานะอายุ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {coupons.filter(c => {
                      const { daysLeft } = getCouponExpiry(c);
                      if (expiryFilter === 'EXPIRED') return daysLeft <= 0;
                      if (expiryFilter === 'EXPIRING') return daysLeft > 0 && daysLeft <= 30;
                      return true;
                    }).map(c => {
                      const { expiryDate, daysLeft } = getCouponExpiry(c);
                      return (
                        <tr key={c.CouponID} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#0C447C] whitespace-nowrap">{c.CouponNo}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{c.SONo}</td>
                          <td className="px-4 py-2.5 text-center text-xs text-gray-400 whitespace-nowrap">{c.DocuDate}</td>
                          <td className="px-4 py-2.5 text-gray-700 max-w-[220px]">
                            <div className="font-medium truncate" title={c.GoodName}>{c.GoodName}</div>
                            {c.beneficiaries && c.beneficiaries.length > 0 && (
                              <div className="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded mt-0.5 inline-block truncate max-w-full font-medium" title={c.beneficiaries.map(b => b.beneficiaryCustName || (b as any).BeneficiaryCustName || b.beneficiaryCustCode || (b as any).BeneficiaryCustCode || b.beneficiaryCustId).join(', ')}>
                                👥 สมาชิก: {c.beneficiaries.map(b => b.beneficiaryCustName || (b as any).BeneficiaryCustName || b.beneficiaryCustCode || (b as any).BeneficiaryCustCode || b.beneficiaryCustId).join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-500 whitespace-nowrap">{Number(c.GoodQty).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                          <td className="px-4 py-2.5 text-right text-gray-400 whitespace-nowrap">{Number(c.RedeemedQty).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                          <td className="px-4 py-2.5 text-right font-bold text-green-600 whitespace-nowrap">
                            {Number(c.RemaQty).toLocaleString(undefined,{maximumFractionDigits:2})}
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs text-gray-500 whitespace-nowrap font-mono">{expiryDate}</td>
                          <td className="px-4 py-2.5 text-center whitespace-nowrap">
                            {daysLeft <= 0 ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">หมดอายุแล้ว</span>
                            ) : daysLeft <= 30 ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">ใกล้หมด ({daysLeft} วัน)</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">เหลือ {daysLeft} วัน</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-100 text-sm">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-bold text-gray-500 whitespace-nowrap">รวม</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-600 whitespace-nowrap">
                        {coupons.reduce((s,c)=>s+Number(c.GoodQty),0).toLocaleString(undefined,{maximumFractionDigits:2})}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-400 whitespace-nowrap">
                        {coupons.reduce((s,c)=>s+Number(c.RedeemedQty),0).toLocaleString(undefined,{maximumFractionDigits:2})}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-green-600 whitespace-nowrap">
                        {coupons.reduce((s,c)=>s+Number(c.RemaQty),0).toLocaleString(undefined,{maximumFractionDigits:2})}
                      </td>
                      <td colSpan={2}></td>
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
