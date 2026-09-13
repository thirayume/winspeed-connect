import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { BarChart3, RefreshCw, Download, FileSpreadsheet, FileText, Search, AlertCircle, ShieldAlert, Settings } from 'lucide-react';
import { fetchReportTypes, fetchReport, exportReport, fetchReportTemplate } from '../../services/api';
import type { ReportData, ReportTypeItem, ResolvedReportTemplateDto } from '../../services/api';
import { LegacyReportPdfModal } from './LegacyReportPdfModal';
import { AdminReportTemplateModal } from '../admin/AdminReportTemplateModal';
import { useAuthStore } from '../../store/auth-store';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import {
  formatReportCell,
  isColumnNumeric,
  calculateReportTotals,
  formatReportTotal
} from '../../utils/reportFormatter';

const CATEGORY_MAP: Record<string, string> = {
  all: 'ทั้งหมด',
  sales: 'งานขาย',
  logistics: 'คลัง/เอกสาร',
  weighing: 'การชั่ง',
  rebate: 'รีเบท',
  finance: 'การเงิน/บัญชี',
};

export function ReportsPage() {
  const currentUser = useAuthStore(s => s.user);
  const isAdmin = currentUser?.role === 'ADMIN';

  const [types, setTypes] = useState<ReportTypeItem[]>([]);
  const [active, setActive] = useState<string>('');
  const [data, setData] = useState<ReportData | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<ResolvedReportTemplateDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const [templateError, setTemplateError] = useState<string | null>(null);

  // Guard against stale asynchronous responses
  const activeReqIdRef = useRef(0);

  // Default to today in local Bangkok timezone (YYYY-MM-DD) and 60 days ago for from date
  const localToday = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const sixtyDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 60);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const [from, setFrom] = useState(sixtyDaysAgo);
  const [to, setTo] = useState(localToday);
  const DATE_RANGE_REPORTS = ['customer-dispatch'];
  const needsDateRange = DATE_RANGE_REPORTS.includes(active);

  const CUST_FILTER_REPORTS = ['customer-dispatch'];
  const needsCustFilter = CUST_FILTER_REPORTS.includes(active);
  const [custCode, setCustCode] = useState('');

  useEffect(() => {
    fetchReportTypes()
      .then(t => {
        setTypes(t);
        if (t[0]) setActive(t[0].key);
      })
      .catch(err => {
        console.error('Failed to load report types:', err);
        setError('ไม่สามารถดึงรายการรายงานได้');
      });
  }, []);

  const reportParams = useCallback((): Record<string, string> | undefined => {
    const p: Record<string, string> = {};
    if (DATE_RANGE_REPORTS.includes(active)) {
      p.from = from;
      p.to = to;
    }
    if (CUST_FILTER_REPORTS.includes(active) && custCode.trim()) {
      p.custCode = custCode.trim();
    }
    return Object.keys(p).length ? p : undefined;
  }, [active, from, to, custCode]);

  const load = useCallback(async (type: string, range?: Record<string, string>) => {
    if (!type) return;
    const reqId = ++activeReqIdRef.current;
    setLoading(true);
    setError(null);
    setTemplateError(null);

    try {
      const [res, tplRes] = await Promise.allSettled([
        fetchReport(type, range),
        fetchReportTemplate(type),
      ]);
      if (activeReqIdRef.current === reqId) {
        if (res.status === 'fulfilled') {
          setData(res.value);
          setError(null);
        } else {
          setError((res.reason as Error)?.message || 'โหลดรายงานไม่สำเร็จ');
          setData(null);
        }
        if (tplRes.status === 'fulfilled') {
          setActiveTemplate(tplRes.value.template);
          setTemplateError(null);
        } else {
          setActiveTemplate(null);
          setTemplateError((tplRes.reason as Error)?.message || 'ไม่สามารถโหลดแม่แบบรายงานทางการได้');
        }
      }
    } catch (e: unknown) {
      if (activeReqIdRef.current === reqId) {
        const msg = (e as Error)?.message || 'โหลดรายงานไม่สำเร็จ';
        setError(msg);
        setData(null);
      }
    } finally {
      if (activeReqIdRef.current === reqId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load(active, reportParams());
  }, [active, load, reportParams]);

  async function doExport() {
    if (!active || exporting || loading) return;
    setExporting(true);
    try {
      await exportReport(active, reportParams());
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  // Filtered reports for sidebar
  const filteredTypes = useMemo(() => {
    return types.filter(t => {
      const matchesSearch = t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            t.key.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCat = selectedCategory === 'all' || t.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [types, searchTerm, selectedCategory]);

  // Summary totals for table
  const totals = useMemo(() => {
    if (!data?.columns || !data?.rows) return {};
    return calculateReportTotals(data.columns, data.rows);
  }, [data]);

  const hasTotals = useMemo(() => {
    return data?.columns.some(c => c.aggregation === 'sum') ?? false;
  }, [data]);

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      {showPdfModal && data && (
        <LegacyReportPdfModal
          data={data}
          template={activeTemplate}
          onClose={() => setShowPdfModal(false)}
        />
      )}
      {showAdminModal && (
        <AdminReportTemplateModal
          isOpen={showAdminModal}
          onClose={() => setShowAdminModal(false)}
          onTemplateUpdated={() => load(active, reportParams())}
        />
      )}

      {/* Top Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> รายงาน (Reports)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
            ศูนย์รายงาน 23 ฉบับ · Typed Contract · พิมพ์ PDF A4 / ส่งออก Excel (SO-10)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowAdminModal(true)}
              className="px-3 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer border border-gray-300"
              title="จัดการหัวกระดาษและแม่แบบรายงาน (เฉพาะผู้ดูแลระบบ)"
            >
              <Settings size={16} className="text-[#0C447C]" /> จัดการแม่แบบ (Admin)
            </button>
          )}

          <button
            onClick={() => setShowPdfModal(true)}
            disabled={!data || loading || exporting || !activeTemplate}
            className="px-3 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:bg-red-700 transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed"
            style={{ background: '#E53935' }}
            title={!activeTemplate ? 'ไม่สามารถพิมพ์ได้เนื่องจากไม่พบแม่แบบรายงานทางการ (Authoritative Master Required)' : 'พิมพ์ / Export PDF (A4)'}
          >
            <FileText size={16} /> พิมพ์ / Export PDF (A4)
          </button>

          <button
            onClick={doExport}
            disabled={!data || loading || exporting}
            className="px-3 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:bg-green-800 transition-colors cursor-pointer disabled:cursor-not-allowed"
            style={{ background: '#3B6D11' }}
          >
            <Download size={16} /> {exporting ? 'กำลังส่งออก...' : 'Export Excel'}
          </button>

          {needsCustFilter && (
            <input
              value={custCode}
              onChange={e => setCustCode(e.target.value)}
              placeholder="รหัส/ชื่อลูกค้า (เว้นว่าง = ทุกราย)"
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          )}

          {needsDateRange && (
            <div className="flex items-center gap-1.5">
              <div className="w-[8.5rem]">
                <ThaiDatePicker
                  value={from}
                  max={to}
                  onChange={setFrom}
                  className="h-10 px-2 rounded-xl border border-gray-200 bg-white text-sm w-full"
                  placeholder="ตั้งแต่วันที่"
                />
              </div>
              <span className="text-gray-400 text-sm">ถึง</span>
              <div className="w-[8.5rem]">
                <ThaiDatePicker
                  value={to}
                  min={from}
                  onChange={setTo}
                  className="h-10 px-2 rounded-xl border border-gray-200 bg-white text-sm w-full"
                  placeholder="ถึงวันที่"
                />
              </div>
            </div>
          )}

          <button
            onClick={() => load(active, reportParams())}
            disabled={loading}
            title="รีเฟรชข้อมูล"
            className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-600'} />
          </button>
        </div>
      </div>

      {templateError && (
        <div className="mx-6 mt-3 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle size={16} className="text-amber-600 shrink-0" />
            <span>ไม่สามารถโหลดแม่แบบรายงานทางการ: <b>{templateError}</b> (ระบบระงับการพิมพ์ PDF ชั่วคราวเพื่อป้องกันการพิมพ์เอกสารผิดมาตรฐาน)</span>
          </div>
          <button
            onClick={() => load(active, reportParams())}
            className="px-3 py-1 bg-amber-200 hover:bg-amber-300 text-amber-950 rounded-lg font-semibold text-xs transition-colors shrink-0 cursor-pointer"
          >
            ลองโหลดใหม่
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
        {/* Mobile Dropdown */}
        <div className="md:hidden p-3 bg-white border-b border-gray-200 shrink-0 space-y-2">
          <select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 text-gray-700 rounded-xl px-4 py-3 font-medium outline-none focus:ring-2 focus:ring-[#0C447C]"
          >
            {types.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
        </div>

        {/* Desktop Sidebar */}
        <div className="hidden md:flex flex-col w-72 border-r border-gray-200 bg-white/70 backdrop-blur shrink-0 overflow-hidden">
          {/* Search Box */}
          <div className="p-3 border-b border-gray-200 bg-white/40">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="ค้นหารายงาน..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
              />
            </div>
            {/* Category Filter Pills */}
            <div className="flex gap-1 overflow-x-auto custom-scrollbar mt-2 pt-1 pb-0.5">
              {Object.entries(CATEGORY_MAP).map(([catKey, catLabel]) => (
                <button
                  key={catKey}
                  onClick={() => setSelectedCategory(catKey)}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                    selectedCategory === catKey
                      ? 'bg-[#0C447C] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {catLabel}
                </button>
              ))}
            </div>
          </div>

          {/* Report List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {filteredTypes.length === 0 ? (
              <p className="text-xs text-center text-gray-400 py-6">ไม่พบรายงานที่ตรงกับคำค้นหา</p>
            ) : (
              filteredTypes.map(t => (
                <button
                  key={t.key}
                  onClick={() => setActive(t.key)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                    active === t.key
                      ? 'bg-[#0C447C] text-white shadow-sm'
                      : 'text-gray-700 hover:bg-gray-100/80'
                  }`}
                >
                  <FileSpreadsheet size={15} className="shrink-0 opacity-80" />
                  <span className="truncate">{t.title}</span>
                </button>
              ))
            )}
          </div>
          <div className="p-2 border-t border-gray-200 bg-white/30 text-[11px] text-gray-400 text-center">
            {filteredTypes.length} จากทั้งหมด {types.length} ฉบับ
          </div>
        </div>

        {/* Report Content Area */}
        <div className="flex-1 overflow-auto p-2 sm:p-6 custom-scrollbar">
          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3">
              <RefreshCw size={32} className="animate-spin text-[#0C447C]" />
              <p className="text-xs text-gray-500 font-medium">กำลังโหลดรายงาน...</p>
            </div>
          ) : error ? (
            <div className="py-20 flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-3">
                {error.includes('สิทธิ์') ? <ShieldAlert size={24} /> : <AlertCircle size={24} />}
              </div>
              <h3 className="text-base font-bold text-gray-800 mb-1">
                {error.includes('สิทธิ์') ? 'ไม่มีสิทธิ์เข้าถึงรายงานนี้' : 'เกิดข้อผิดพลาดในการโหลดข้อมูล'}
              </h3>
              <p className="text-xs text-gray-500 mb-4">{error}</p>
              <button
                onClick={() => load(active, reportParams())}
                className="px-4 py-2 bg-[#0C447C] text-white text-xs font-semibold rounded-lg hover:bg-blue-900 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <RefreshCw size={13} /> ลองใหม่
              </button>
            </div>
          ) : !data ? (
            <div className="py-20 text-center text-sm text-gray-400">เลือกรายงานที่ต้องการดูจากเมนูด้านซ้าย</div>
          ) : (
            <div className="bg-white rounded-none sm:rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
              {/* Report Header Card */}
              <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-gray-50 to-white">
                <div>
                  <h2 className="text-base font-bold text-gray-800">{data.title}</h2>
                  <span className="text-xs text-gray-400">รหัสรายงาน: <code className="font-mono">{data.type}</code></span>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-800 border border-blue-100">
                  {data.rows.length.toLocaleString('th-TH')} แถว
                </span>
              </div>

              {/* Data Table */}
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-sm min-w-full">
                  <thead className="bg-gray-50 text-xs font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap">
                    <tr>
                      {data.columns.map(c => {
                        const isNum = isColumnNumeric(c);
                        const isIdent = c.type === 'identifier';
                        return (
                          <th
                            key={c.key}
                            className={`px-4 py-3 ${isNum ? 'text-right' : 'text-left'} ${isIdent ? 'font-mono' : ''}`}
                          >
                            {c.label}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {data.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                        {data.columns.map(c => {
                          const isNum = isColumnNumeric(c);
                          const isIdent = c.type === 'identifier';
                          return (
                            <td
                              key={c.key}
                              className={`px-4 py-2.5 text-xs ${
                                isNum ? 'text-right tabular-nums font-medium text-gray-800' : 'text-left text-gray-700'
                              } ${isIdent ? 'font-mono text-gray-900 font-semibold' : ''}`}
                            >
                              {formatReportCell(row[c.key], c)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {data.rows.length === 0 && (
                      <tr>
                        <td colSpan={data.columns.length} className="py-14 text-center text-gray-400 whitespace-nowrap">
                          ไม่มีข้อมูลในช่วงที่เลือก
                        </td>
                      </tr>
                    )}
                  </tbody>

                  {/* Summary / Total Footer */}
                  {hasTotals && data.rows.length > 0 && (
                    <tfoot className="bg-amber-50/70 border-t-2 border-amber-200 text-xs font-bold text-gray-800">
                      <tr>
                        {data.columns.map((c, colIdx) => {
                          const isNum = isColumnNumeric(c);
                          if (colIdx === 0) {
                            return (
                              <td key={c.key} className="px-4 py-3 text-left font-bold text-amber-900">
                                รวมทั้งสิ้น (Total)
                              </td>
                            );
                          }
                          if (c.aggregation === 'sum') {
                            return (
                              <td key={c.key} className={`px-4 py-3 ${isNum ? 'text-right tabular-nums' : 'text-left'} text-amber-950`}>
                                {formatReportTotal(totals[c.key], c)}
                              </td>
                            );
                          }
                          return <td key={c.key} className="px-4 py-3"></td>;
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
