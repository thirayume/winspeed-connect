import React, { useEffect, useState } from 'react';
import { Award, Filter, RefreshCw, DollarSign, PieChart, ShieldCheck, Download } from 'lucide-react';
import { fetchRebateClaims } from '../../services/api';
import type { RebateClaim } from '../../types';

export function IncentiveReport() {
  const [claims, setClaims] = useState<RebateClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchRebateClaims('APPROVED');
      setClaims(data);
    } catch (e) {
      console.error('Failed to load incentive claims:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = claims.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.CustName && c.CustName.toLowerCase().includes(q)) ||
      (c.CustId && c.CustId.toLowerCase().includes(q)) ||
      (c.CnDocuNo && c.CnDocuNo.toLowerCase().includes(q))
    );
  });

  const totalClaimed = filtered.reduce((s, c) => s + (Number(c.ClaimAmt) || 0), 0);
  const totalCustomerAmt = filtered.reduce((s, c) => s + (Number((c as any).CustomerAmount) || (Number(c.ClaimAmt) * ((c as any).CustomerRatio ?? 100) / 100)), 0);
  const totalRetainedAmt = filtered.reduce((s, c) => s + (Number((c as any).RetainedAmount) || (Number(c.ClaimAmt) * ((c as any).CompanyRatio ?? 0) / 100)), 0);

  return (
    <div className="h-full flex flex-col w-full overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-black text-[#0C447C] flex items-center gap-2">
            <Award className="w-6 h-6" /> รายงานสรุปส่วนต่างและเงินสะสมบริษัท (Incentive & Retained Report)
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            สรุปสัดส่วนการคืนรีเบทลูกค้า (Customer Ratio) และยอดสะสมเข้าบริษัท (Retained Amount)
          </p>
        </div>
        <button onClick={loadData} className="px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold flex items-center gap-2">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> โหลดข้อมูลใหม่
        </button>
      </div>

      {/* KPI Cards */}
      <div className="p-6 pb-2 grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="bg-blue-50 p-3 rounded-xl text-[#0C447C]">
            <DollarSign size={24} />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">ยอดอนุมัติรวมทั้งหมด</div>
            <div className="text-2xl font-black text-[#0C447C]">
              ฿{totalClaimed.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-blue-100 shadow-sm flex items-center gap-4">
          <div className="bg-blue-100 p-3 rounded-xl text-blue-800">
            <PieChart size={24} />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">ยอดคืนลูกค้า (Customer Portion)</div>
            <div className="text-2xl font-black text-blue-700">
              ฿{totalCustomerAmt.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm flex items-center gap-4">
          <div className="bg-emerald-50 p-3 rounded-xl text-emerald-600">
            <ShieldCheck size={24} />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500">สะสมเข้าบริษัท (Retained Portion)</div>
            <div className="text-2xl font-black text-emerald-700">
              ฿{totalRetainedAmt.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Table */}
      <div className="flex-1 p-6 flex flex-col overflow-hidden">
        <div className="mb-4 flex items-center justify-between gap-4">
          <input
            type="text"
            placeholder="ค้นหาลูกค้า, เลขที่ CN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-72 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]/50"
          />
        </div>

        <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-x-auto flex-1 custom-scrollbar">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="p-3.5">เลขที่ใบลดหนี้</th>
                  <th className="p-3.5">ลูกค้า</th>
                  <th className="p-3.5 text-right">ยอดรวม (บาท)</th>
                  <th className="p-3.5 text-center">สัดส่วน (ลูกค้า / บริษัท)</th>
                  <th className="p-3.5 text-right text-blue-700">ยอดคืนลูกค้า</th>
                  <th className="p-3.5 text-right text-emerald-700">สะสมบริษัท</th>
                  <th className="p-3.5 text-center">สถานะ Self Claim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-400 font-medium">กำลังโหลดข้อมูล...</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-400 font-medium">ไม่พบรายการอนุมัติ</td>
                  </tr>
                ) : filtered.map(c => {
                  const claimAmt = Number(c.ClaimAmt) || 0;
                  const custRatio = (c as any).CustomerRatio ?? 100;
                  const compRatio = (c as any).CompanyRatio ?? (100 - custRatio);
                  const custAmt = Number((c as any).CustomerAmount) || (claimAmt * custRatio / 100);
                  const retAmt = Number((c as any).RetainedAmount) || (claimAmt * compRatio / 100);
                  const isSelf = (c as any).IsSelfClaim;

                  return (
                    <tr key={c.Id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-gray-800">{c.CnDocuNo || `#${c.Id}`}</td>
                      <td className="p-3.5 text-gray-700 font-medium">{c.CustName || c.CustId}</td>
                      <td className="p-3.5 text-right font-bold tabular-nums">฿{claimAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3.5 text-center font-semibold text-xs">
                        <span className="text-blue-700">{custRatio}%</span> / <span className="text-emerald-700">{compRatio}%</span>
                      </td>
                      <td className="p-3.5 text-right font-bold text-blue-700 tabular-nums">฿{custAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3.5 text-right font-bold text-emerald-700 tabular-nums">฿{retAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3.5 text-center">
                        {isSelf ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            Self Claim
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                            ปกติ
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
