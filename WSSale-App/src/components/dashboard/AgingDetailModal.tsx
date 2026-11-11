import { useState, useEffect, useCallback } from 'react';
import { X, Search, FileSpreadsheet, RefreshCw, Calendar, Truck, AlertTriangle, Clock } from 'lucide-react';
import { searchAgingOrders } from '../../services/api';
import type { AgingRow } from '../../types';
import { exportToExcel, type ExportColumn } from '../../utils/exportUtils';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { appAlert } from '../ui/AppAlert';
import { formatThaiDate } from '../../utils/date';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function AgingDetailModal({ isOpen, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Filters
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minDays, setMinDays] = useState<number>(0);
  const [allDates, setAllDates] = useState(true);

  const loadData = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const res = await searchAgingOrders({
        q: search.trim() || undefined,
        dateFrom: allDates ? undefined : (dateFrom || undefined),
        dateTo: allDates ? undefined : (dateTo || undefined),
        minDays: minDays > 0 ? minDays : undefined,
        all: allDates,
        page: targetPage,
        pageSize
      });
      setRows(res.data || []);
      setTotal(res.total || 0);
      setPage(targetPage);
    } catch (err) {
      console.error('Failed to load aging details:', err);
    } finally {
      setLoading(false);
    }
  }, [search, dateFrom, dateTo, minDays, allDates]);

  useEffect(() => {
    if (isOpen) {
      loadData(1);
    }
  }, [isOpen, loadData]);

  const totalTons = rows.reduce((s, r) => s + Number(r.QtyTon || 0), 0);
  const maxDays = rows.reduce((m, r) => Math.max(m, Number(r.DaysOpen || 0)), 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleExportExcel = async (exportAll: boolean) => {
    setExporting(true);
    try {
      let exportRows: AgingRow[] = [];
      if (exportAll) {
        const res = await searchAgingOrders({
          q: search.trim() || undefined,
          dateFrom: allDates ? undefined : (dateFrom || undefined),
          dateTo: allDates ? undefined : (dateTo || undefined),
          minDays: minDays > 0 ? minDays : undefined,
          all: allDates,
          export: true
        });
        exportRows = res.data || [];
      } else {
        exportRows = rows;
      }

      if (exportRows.length === 0) {
        void appAlert('ไม่มีข้อมูลสำหรับส่งออก', 'info');
        return;
      }

      const columns: ExportColumn[] = [
        { key: 'CreatedAt', label: 'วันที่สั่งจอง', formatter: (v: unknown) => formatThaiDate(v ? String(v) : null) },
        { key: 'WfRef', label: 'เลขที่เอกสาร (WF Ref)' },
        { key: 'CustName', label: 'ชื่อลูกค้า' },
        { key: 'TruckPlate', label: 'ทะเบียนรถ' },
        { key: 'GoodCode', label: 'รหัสสินค้า' },
        { key: 'GoodName', label: 'ชื่อสินค้า' },
        { key: 'QtyTon', label: 'จำนวน (ตัน)', formatter: (v: any) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
        { key: 'DaysOpen', label: 'จำนวนวันค้างส่ง (วัน)' },
        { key: 'Status', label: 'สถานะ' },
      ];

      const formatted = exportRows.map(r => ({
        ...r,
        Status: r.DaysOpen > 45 ? 'ค้างวิกฤต (>45 วัน)' : r.DaysOpen > 30 ? 'ค้างนาน (>30 วัน)' : 'ปกติ'
      }));

      const dateNote = allDates ? 'ทั้งหมด' : `${dateFrom ? formatThaiDate(dateFrom).replace(/\//g, '-') : 'เริ่มต้น'}_ถึง_${dateTo ? formatThaiDate(dateTo).replace(/\//g, '-') : 'ปัจจุบัน'}`;
      exportToExcel(`บิลค้างจัดส่งนาน_${dateNote}`, 'บิลค้างส่ง', columns, formatted);
    } catch (e: any) {
      void appAlert('ส่งออก Excel ไม่สำเร็จ: ' + (e?.message || 'ข้อผิดพลาดระบบ'), 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#0C447C] to-[#184E88] text-white flex items-center justify-between shrink-0 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-xl">
              <Clock size={22} className="text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">รายการบิลค้างจัดส่งนานโดยละเอียด</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-amber-950 uppercase">
                  Aging Orders
                </span>
              </div>
              <p className="text-xs text-blue-100/90 mt-0.5">
                ตรวจสอบบิลสั่งจองที่ยังค้างส่งทั้งหมด ค้นหาตามช่วงเวลา และส่งออก Excel ได้อย่างละเอียด
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="p-4 bg-slate-50 border-b border-gray-200 flex flex-col gap-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
              <input
                type="text"
                placeholder="ค้นหาเลขที่บิล, ชื่อลูกค้า, หรือชื่อสินค้า..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadData(1); }}
                className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0C447C]/20 focus:border-[#0C447C]"
              />
            </div>

            {/* Overdue severity threshold pills */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-400 font-medium text-[11px] mr-1">เกณฑ์ค้างส่ง:</span>
              {[
                { label: 'ทั้งหมด', val: 0 },
                { label: '>30 วัน', val: 30 },
                { label: '>45 วัน', val: 45 },
                { label: '>90 วัน', val: 90 },
                { label: '>180 วัน', val: 180 },
              ].map(t => (
                <button
                  key={t.val}
                  type="button"
                  onClick={() => { setMinDays(t.val); }}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                    minDays === t.val
                      ? 'bg-[#0C447C] text-white shadow-xs'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadData(1)}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                <span>รีเฟรช</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportExcel(true)}
                disabled={exporting || total === 0}
                className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <FileSpreadsheet size={13} />
                <span>{exporting ? 'กำลังส่งออก…' : 'Export Excel ทั้งหมด'}</span>
              </button>
            </div>
          </div>

          {/* Date Range Row */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-200/60 text-xs">
            <label className="flex items-center gap-1.5 font-medium text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allDates}
                onChange={e => setAllDates(e.target.checked)}
                className="rounded accent-[#0C447C]"
              />
              <span>ดูข้อมูลทุกช่วงเวลา (ไม่จำกัด 180 วัน)</span>
            </label>

            {!allDates && (
              <div className="flex items-center gap-2 ml-2 pl-3 border-l border-gray-300">
                <span className="text-gray-500 font-medium">วันที่สั่งจอง:</span>
                <div className="w-36">
                  <ThaiDatePicker
                    value={dateFrom}
                    onChange={setDateFrom}
                    max={dateTo || undefined}
                    className="w-full px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs"
                    placeholder="วว/ดด/ปปปป"
                  />
                </div>
                <span className="text-gray-400">ถึง</span>
                <div className="w-36">
                  <ThaiDatePicker
                    value={dateTo}
                    onChange={setDateTo}
                    min={dateFrom || undefined}
                    className="w-full px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs"
                    placeholder="วว/ดด/ปปปป"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => loadData(1)}
                  className="px-2 py-1 bg-[#0C447C] text-white rounded-lg text-xs font-semibold hover:bg-blue-900 transition-colors"
                >
                  ค้นหา
                </button>
              </div>
            )}
          </div>
        </div>

        {/* KPI Summary Bar */}
        <div className="px-6 py-2.5 bg-blue-50/60 border-b border-blue-100 flex items-center justify-between text-xs text-blue-950 font-medium shrink-0">
          <div className="flex items-center gap-6">
            <span>พบทั้งหมด: <strong className="text-[#0C447C] font-bold text-sm">{total.toLocaleString()}</strong> รายการ</span>
            <span>ปริมาณหน้าปัจจุบัน: <strong className="text-[#0C447C] font-bold text-sm">{totalTons.toLocaleString('th-TH', { maximumFractionDigits: 2 })}</strong> ตัน</span>
            <span>ค้างส่งนานสุด: <strong className="text-rose-600 font-bold text-sm">{maxDays}</strong> วัน</span>
          </div>
          <div className="text-gray-500 text-[11px]">
            หน้า {page} จาก {totalPages}
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 overflow-auto bg-white">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-gray-100/80 sticky top-0 z-10 border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="px-4 py-2.5">วันที่จอง</th>
                <th className="px-4 py-2.5">เลขที่บิล (WF Ref)</th>
                <th className="px-4 py-2.5">ลูกค้า</th>
                <th className="px-4 py-2.5">ทะเบียนรถ</th>
                <th className="px-4 py-2.5">สินค้า</th>
                <th className="px-4 py-2.5 text-right">จำนวน (ตัน)</th>
                <th className="px-4 py-2.5 text-center">ค้างส่ง (วัน)</th>
                <th className="px-4 py-2.5 text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-[#0C447C]" />
                    กำลังโหลดข้อมูลบิลค้างจัดส่ง…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    ไม่พบรายการบิลค้างจัดส่งตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const isCritical = r.DaysOpen > 45;
                  const isWarning = r.DaysOpen > 30;
                  return (
                    <tr key={`${r.SoId}-${r.GoodCode}-${i}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 font-mono text-[11px]">
                        {formatThaiDate(r.CreatedAt)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono font-bold text-[#0C447C]">
                        {r.WfRef || '—'}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-gray-800 max-w-xs truncate" title={r.CustName}>
                        {r.CustName}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-gray-600 font-mono text-[11px]">
                        <span className="inline-flex items-center gap-1">
                          <Truck size={12} className="text-gray-400" />
                          {r.TruckPlate || 'ไม่ระบุรถ'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 max-w-xs truncate" title={r.GoodName}>
                        <div className="font-medium text-gray-700">{r.GoodName || '—'}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{r.GoodCode}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-700 tabular-nums whitespace-nowrap">
                        {Number(r.QtyTon || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          isCritical
                            ? 'bg-rose-100 text-rose-700'
                            : isWarning
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {r.DaysOpen} วัน
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <span className="text-[11px] font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                          {r.Status || 'CONFIRMED'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-gray-200 flex items-center justify-between text-xs shrink-0">
          <div className="text-gray-500">
            แสดง {rows.length > 0 ? (page - 1) * pageSize + 1 : 0} ถึง {Math.min(page * pageSize, total)} จากทั้งหมด {total.toLocaleString()} รายการ
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadData(page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1 bg-white border border-gray-200 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ก่อนหน้า
            </button>
            <span className="font-bold text-[#0C447C] px-2">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => loadData(page + 1)}
              disabled={page >= totalPages || loading}
              className="px-3 py-1 bg-white border border-gray-200 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ถัดไป
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
