import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ChevronRight, ChevronLeft, Users, Package } from 'lucide-react';
import { fetchVoucherSummary, fetchCouponCustomers, fetchCouponDetail } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import type { VoucherSummary, CouponCustomer, CouponRow } from '../../types';

function getCouponExpiry(c: { expiryDate?: string; daysLeft?: number | null }) {
  return {expiryDate:c.expiryDate||'ไม่ระบุ',daysLeft:typeof c.daysLeft==='number'?c.daysLeft:null};
}

type HierarchyView = 'summary' | 'customer' | 'coupon';

export function VoucherPage() {
  const { user } = useAuthStore();
  const isSales = user?.role === 'SALES';

  const [summary, setSummary]           = useState<VoucherSummary[]>([]);
  const [customers, setCustomers]       = useState<CouponCustomer[]>([]);
  const [coupons, setCoupons]           = useState<CouponRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [hierarchyView, setHierarchyView] = useState<HierarchyView>(isSales?'customer':'summary');
  const [selEmp, setSelEmp]             = useState<VoucherSummary | null>(null);
  const [selCust, setSelCust]           = useState<CouponCustomer | null>(null);
  const [expiryFilter, setExpiryFilter] = useState<'ALL' | 'EXPIRING' | 'EXPIRED' | 'TODAY'>('ALL');
  const [loadError,setLoadError]=useState('');

  const load = useCallback(async () => {
    setLoading(true);setLoadError('');
    try {
      setLoadError('');
      const sumData=await fetchVoucherSummary();
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
        const myCustomers = await fetchCouponCustomers({ empId: Number(user.empId) });
        setCustomers(myCustomers);
      }
    } catch (e) {
      console.error(e);setLoadError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่');
    }
    setLoading(false);
  }, [isSales, user]);

  useEffect(() => { load(); }, [load]);

  async function drillEmp(emp: VoucherSummary) {
    setSelEmp(emp);
    setLoading(true);setLoadError('');
    try {
      setCustomers(await fetchCouponCustomers({ empId: Number(emp.EmpID) }));
      setHierarchyView('customer');
    } catch (e) { console.error(e);setLoadError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่');setCustomers([]);setCoupons([]); }
    setLoading(false);
  }

  async function drillCust(cust: CouponCustomer) {
    setSelCust(cust);
    setLoading(true);setLoadError('');
    try {
      setCoupons(await fetchCouponDetail(cust.CustID));
      setHierarchyView('coupon');
    } catch (e) { console.error(e);setLoadError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่');setCustomers([]);setCoupons([]); }
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

  const visibleCoupons=coupons.filter(c=>expiryFilter==='EXPIRED'?c.daysLeft!=null&&c.daysLeft<0:expiryFilter==='TODAY'?c.daysLeft===0:expiryFilter==='EXPIRING'?c.isExpiringSoon===true:true);
  const totalTon  = summary.reduce((s, r) => s + Number(r.OutstandingTon || 0), 0);
  const totalCust = summary.reduce((s, r) => s + Number(r.CustCount || 0), 0);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="p-4 bg-white border-b flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {hierarchyView!=='summary'&&<button aria-label="ย้อนกลับรายชื่อตามสังกัด" onClick={goBackHierarchy}><ChevronLeft size={18}/></button>}
          <div><h2 className="font-bold text-[#0C447C]">รายชื่อตามสังกัด</h2><p className="text-xs text-gray-500">ยอดคงเหลือจริงใน WinSpeed ก่อนหักยอดจอง · ดูยอดพร้อมใช้ที่แท็บรายการตั๋ว</p></div>
        </div>
        <button aria-label="โหลดรายชื่อตามสังกัดใหม่" onClick={()=>{setHierarchyView(isSales?'customer':'summary');setSelCust(null);load();}}><RefreshCw size={18}/></button>
      </div>
      {loadError&&<p role="alert" className="p-4 text-red-700">{loadError}</p>}
      <div className="flex-1 overflow-y-auto p-2 sm:p-6 space-y-3 sm:space-y-5">

        {/* ── HIERARCHY TAB ── */}
        {hierarchyView === 'summary' && (
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
        {hierarchyView === 'customer' && (
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
        {hierarchyView === 'coupon' && (
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
                <button type="button" onClick={()=>setExpiryFilter('TODAY')} className={`px-2.5 py-1 rounded-lg font-medium ${expiryFilter==='TODAY'?'bg-amber-600 text-white':'bg-amber-50 text-amber-800'}`}>หมดอายุวันนี้</button>
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
                      <th className="px-4 py-3 text-left whitespace-nowrap">เลขบิล</th>
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
                    {visibleCoupons.map(c => {
                      const { expiryDate, daysLeft } = getCouponExpiry(c);
                      return (
                        <tr key={c.CouponID} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#0C447C] whitespace-nowrap">{c.CouponNo}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{c.SONo||'ยอดยกมา'}</td>
                          <td className="px-4 py-2.5 text-center text-xs text-gray-400 whitespace-nowrap">{c.DocuDate||'ยอดยกมา'}</td>
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
                            {daysLeft === null ? <span>ไม่ระบุวันหมดอายุ</span> : daysLeft === 0 ? <span className="text-amber-700">หมดอายุวันนี้ (ยังใช้ได้)</span> : daysLeft < 0 ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">หมดอายุแล้ว</span>
                            ) : c.isExpiringSoon ? (
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
                        {visibleCoupons.reduce((s,c)=>s+Number(c.GoodQty),0).toLocaleString(undefined,{maximumFractionDigits:2})}
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
