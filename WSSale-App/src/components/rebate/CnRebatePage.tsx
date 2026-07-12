import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, FileCheck2, RefreshCw, Search } from 'lucide-react';
import {
  fetchWfRebateTrailDetail,
  fetchWfRebateTrailList,
  fetchWfRebateTrailSummary,
} from '../../services/api';
import type { WfRebateTrailDetail, WfRebateTrailRow, WfRebateTrailSummary } from '../../types';

type View = 'summary' | 'list' | 'detail';

const fmtTon = (n: unknown) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const fmtDate = (v: unknown) => String(v || '').slice(0, 10) || '-';
const currentYear = new Date().getFullYear() + 543;

function val(row: Record<string, unknown> | null | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function MiniTable({ title, rows, columns }: {
  title: string;
  rows: Record<string, unknown>[];
  columns: { key: string; label: string; align?: 'right' | 'center' }[];
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-700">{title}</h2>
        <p className="text-xs text-gray-400">{rows.length} rows</p>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              {columns.map(c => (
                <th key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-50/70">
                {columns.map(c => (
                  <td key={c.key} className={`px-3 py-2 text-gray-700 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : ''}`}>
                    {val(row, c.key)}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-gray-300">No data</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CnRebatePage() {
  const [view, setView] = useState<View>('summary');
  const [year, setYear] = useState<number | undefined>(undefined);
  const [summary, setSummary] = useState<WfRebateTrailSummary[]>([]);
  const [list, setList] = useState<WfRebateTrailRow[]>([]);
  const [detail, setDetail] = useState<WfRebateTrailDetail | null>(null);
  const [selectedSales, setSelectedSales] = useState<WfRebateTrailSummary | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<WfRebateTrailRow | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const yearOptions = useMemo(() => Array.from({ length: 10 }, (_, i) => currentYear - i), []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await fetchWfRebateTrailSummary({ year }));
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  async function drillSales(row: WfRebateTrailSummary) {
    setSelectedSales(row);
    setLoading(true);
    try {
      setList(await fetchWfRebateTrailList({ year, empId: Number(row.EmpID) }));
      setView('list');
    } finally {
      setLoading(false);
    }
  }

  async function drillOrder(row: WfRebateTrailRow) {
    setSelectedOrder(row);
    setLoading(true);
    try {
      setDetail(await fetchWfRebateTrailDetail(Number(row.SOID)));
      setView('detail');
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    if (view === 'detail') {
      setView('list');
      setSelectedOrder(null);
      setDetail(null);
    } else {
      setView('summary');
      setSelectedSales(null);
      setList([]);
    }
  }

  async function runSearch(next = search) {
    setSearch(next);
    if (view !== 'list') return;
    setLoading(true);
    try {
      setList(await fetchWfRebateTrailList({ year, empId: selectedSales?.EmpID ? Number(selectedSales.EmpID) : undefined, q: next || undefined }));
    } finally {
      setLoading(false);
    }
  }

  const totalOrders = summary.reduce((s, r) => s + Number(r.OrderCount || 0), 0);
  const totalCoupons = summary.reduce((s, r) => s + Number(r.CouponCount || 0), 0);
  const totalRedeemed = summary.reduce((s, r) => s + Number(r.RedeemedTon || 0), 0);
  const totalRemaining = summary.reduce((s, r) => s + Number(r.RemainingTon || 0), 0);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {view !== 'summary' && (
            <button onClick={goBack} className="h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50">
              <ChevronLeft size={17} />
            </button>
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
              <FileCheck2 className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
              {view === 'summary' && 'WF Rebate Trail'}
              {view === 'list' && `Orders by ${selectedSales?.SalesName || 'salesperson'}`}
              {view === 'detail' && `${selectedOrder?.SONo || 'Order detail'}`}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              WINSpeed read-only flow: SO booking, control ticket, coupon, redemption, invoice, receipt, VAT and GL.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <Calendar size={14} className="text-gray-400" />
            <select
              value={year ?? ''}
              onChange={e => setYear(e.target.value ? Number(e.target.value) : undefined)}
              className="text-sm bg-transparent border-0 outline-none text-gray-700 pr-1"
            >
              <option value="">All years</option>
              {yearOptions.map(y => <option key={y} value={y - 543}>{y}</option>)}
            </select>
          </div>
          <button onClick={view === 'summary' ? loadSummary : () => runSearch(search)} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 min-h-0">
        {view === 'summary' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ['Orders', totalOrders],
                ['Coupons', totalCoupons],
                ['Redeemed tons', fmtTon(totalRedeemed)],
                ['Remaining tons', fmtTon(totalRemaining)],
              ].map(([label, value]) => (
                <div key={label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                  <div className="text-xs text-gray-400">{label}</div>
                  <div className="text-2xl font-black mt-1" style={{ color: '#0C447C' }}>{value}</div>
                </div>
              ))}
            </div>

            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-700">Summary by salesperson</h2>
              </div>
              {loading ? (
                <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="px-5 py-3 text-left">Salesperson</th>
                        <th className="px-4 py-3 text-right">Orders</th>
                        <th className="px-4 py-3 text-right">Coupons</th>
                        <th className="px-4 py-3 text-right">Redeemed</th>
                        <th className="px-4 py-3 text-right">Remaining</th>
                        <th className="px-4 py-3 text-center">Last date</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {summary.map(row => (
                        <tr key={row.EmpID || row.SalesName} onClick={() => drillSales(row)} className="hover:bg-blue-50/40 cursor-pointer">
                          <td className="px-5 py-3 font-semibold text-gray-800">{row.SalesName}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.OrderCount}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.CouponCount}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-green-700">{fmtTon(row.RedeemedTon)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-amber-700">{fmtTon(row.RemainingTon)}</td>
                          <td className="px-4 py-3 text-center text-xs text-gray-400">{fmtDate(row.LastDocuDate)}</td>
                          <td className="px-4 py-3"><ChevronRight size={16} className="ml-auto text-gray-300" /></td>
                        </tr>
                      ))}
                      {!summary.length && (
                        <tr><td colSpan={7} className="py-10 text-center text-gray-300">No trail data found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {view === 'list' && (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
              <Search size={15} className="text-gray-400" />
              <input
                value={search}
                onChange={e => runSearch(e.target.value)}
                placeholder="Search SO, control ticket, coupon, invoice, customer..."
                className="flex-1 text-sm outline-none bg-transparent text-gray-700 placeholder-gray-300"
              />
            </div>
            {loading ? (
              <div className="py-12 flex justify-center"><RefreshCw size={24} className="animate-spin text-gray-300" /></div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">SO</th>
                      <th className="px-4 py-3 text-left">Control</th>
                      <th className="px-4 py-3 text-left">Customer</th>
                      <th className="px-4 py-3 text-right">Coupons</th>
                      <th className="px-4 py-3 text-right">Redeemed</th>
                      <th className="px-4 py-3 text-right">Remaining</th>
                      <th className="px-4 py-3 text-left">Redemption</th>
                      <th className="px-4 py-3 text-left">Invoice</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {list.map(row => (
                      <tr key={row.SOID} onClick={() => drillOrder(row)} className="hover:bg-blue-50/40 cursor-pointer">
                        <td className="px-4 py-3 font-mono text-xs font-bold text-[#0C447C]">{row.SONo}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.ControlNo || '-'}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate" title={row.CustName}>{row.CustName}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.CouponCount}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-green-700">{fmtTon(row.RedeemedTon)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-700">{fmtTon(row.RemainingTon)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.RedemptionNo || '-'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.InvoiceNo || '-'}</td>
                        <td className="px-4 py-3"><ChevronRight size={16} className="ml-auto text-gray-300" /></td>
                      </tr>
                    ))}
                    {!list.length && (
                      <tr><td colSpan={9} className="py-10 text-center text-gray-300">No orders found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === 'detail' && (
          <>
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-gray-400">Sale order</div>
                <div className="font-mono font-bold text-[#0C447C] mt-1">{val(detail?.so, 'DocuNo')}</div>
                <div className="text-gray-500 mt-1">SOID {val(detail?.so, 'SOID')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Booking / control ticket</div>
                <div className="font-mono font-bold text-gray-700 mt-1">{val(detail?.booking, 'DocuNo')}</div>
                <div className="text-gray-500 mt-1">AI {val(detail?.booking, 'AppvDocuNo')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Customer</div>
                <div className="font-bold text-gray-800 mt-1">{val(detail?.so, 'CustName')}</div>
                <div className="text-gray-500 mt-1">{val(detail?.so, 'SalesName')}</div>
              </div>
            </div>

            <MiniTable
              title="Coupons and redemption"
              rows={detail?.coupons || []}
              columns={[
                { key: 'CouponNo', label: 'Coupon' },
                { key: 'GoodName', label: 'Good' },
                { key: 'GoodQty', label: 'Qty', align: 'right' },
                { key: 'RemaQty', label: 'Remain', align: 'right' },
                { key: 'RedemptionNo', label: 'Redemption' },
                { key: 'PostInv', label: 'Post inv', align: 'center' },
                { key: 'InvoiceNo', label: 'Invoice' },
              ]}
            />

            <MiniTable
              title="Invoices"
              rows={detail?.invoices || []}
              columns={[
                { key: 'SOInvID', label: 'SOInvID', align: 'right' },
                { key: 'DocuNo', label: 'DocuNo' },
                { key: 'Docutype', label: 'Type', align: 'center' },
                { key: 'SONo', label: 'SONo' },
                { key: 'PostID', label: 'PostID', align: 'right' },
                { key: 'DocuStatus', label: 'Status', align: 'center' },
              ]}
            />

            <MiniTable
              title="Receipts / AR"
              rows={detail?.receipts || []}
              columns={[
                { key: 'ARReceID', label: 'ARReceID', align: 'right' },
                { key: 'DocuNo', label: 'DocuNo' },
                { key: 'DocuType', label: 'Type', align: 'center' },
                { key: 'SOInvID', label: 'SOInvID', align: 'right' },
                { key: 'PostID', label: 'PostID', align: 'right' },
                { key: 'DocuStatus', label: 'Status', align: 'center' },
              ]}
            />

            <MiniTable
              title="VAT / GL / Bank trail"
              rows={[...(detail?.vat || []), ...(detail?.gl || []), ...(detail?.bank || [])]}
              columns={[
                { key: 'Source', label: 'Source' },
                { key: 'DocuNo', label: 'DocuNo' },
                { key: 'FromID', label: 'FromID', align: 'right' },
                { key: 'GLID', label: 'GLID', align: 'right' },
                { key: 'AccID', label: 'AccID', align: 'right' },
                { key: 'DrAmnt', label: 'Dr', align: 'right' },
                { key: 'CrAmnt', label: 'Cr', align: 'right' },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}
