import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { BarChart3, RefreshCw, Download, FileSpreadsheet, FileText, Search, AlertCircle, ShieldAlert } from 'lucide-react';
import { fetchReportTypes, fetchReport, exportReport, fetchReportTemplate, fetchReportPeriods } from '../../services/api';
import type {
  ReportData,
  ReportTypeItem,
  ResolvedReportTemplateDto,
  ReportPeriodItem,
  SheetLayout,
  SheetLayoutPair,
  SheetLayoutLineEntry,
} from '../../services/api';
import { LegacyReportPdfModal } from './LegacyReportPdfModal';
import { useAuthStore } from '../../store/auth-store';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { SearchableSelect } from '../ui/SearchableSelect';
import { appAlert } from '../ui/AppAlert';
import { bangkokDate } from '../../utils/date';
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
  accounting: 'ต้นทุน/บัญชี',
  audit: 'ตรวจสอบ/Audit',
};

function formatSheetMoney(val: number): string {
  return Number(val || 0).toLocaleString('th-TH', {
    minimumFractionDigits: Number.isInteger(val) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function renderSheetPriceCell(cell?: { price: number; lineStatus: string; marker?: string } | null) {
  if (!cell) return <span className="text-gray-300">—</span>;
  if (cell.lineStatus === 'SUSPENDED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[11px]">
        งดขาย
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1 font-bold tabular-nums text-gray-900">
      <span>{formatSheetMoney(cell.price)}</span>
      {cell.lineStatus === 'DISCONTINUING' && (
        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold" title="กำลังยกเลิกจำหน่าย">
          ***
        </span>
      )}
    </span>
  );
}

function SheetSideBySideSection({
  title,
  pairs,
  priceHeaderLabel,
  accentClass,
}: {
  title: string;
  pairs: SheetLayoutPair[];
  priceHeaderLabel: string;
  accentClass: string;
}) {
  if (!pairs.length) return null;
  const renderHalf = (entry: SheetLayoutLineEntry | null, isRight: boolean) => {
    const borderCls = isRight ? 'border-l-2 border-gray-300' : '';
    if (!entry) {
      return (
        <>
          <td className={`px-2 py-2 ${borderCls}`} />
          <td className="px-3 py-2" />
          <td className="px-3 py-2" />
        </>
      );
    }
    return (
      <>
        <td className={`px-2 py-2 text-center text-xs text-gray-500 tabular-nums ${borderCls}`}>
          {entry.no}
        </td>
        <td className="px-3 py-2 text-xs text-gray-800">
          <div className="font-semibold text-gray-900 flex items-center gap-1.5 flex-wrap">
            <span>{entry.goodName}</span>
            {entry.lineStatus === 'DISCONTINUING' && (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 rounded">***</span>
            )}
          </div>
          {entry.remark && <div className="text-[10px] text-gray-500 mt-0.5">{entry.remark}</div>}
        </td>
        <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
          {renderSheetPriceCell(entry)}
        </td>
      </>
    );
  };

  return (
    <div className="border border-gray-300 rounded-xl overflow-hidden">
      <div className={`px-4 py-2 text-xs font-extrabold tracking-wide ${accentClass}`}>
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100 text-gray-700 font-bold border-b border-gray-300">
              <th className="px-2 py-2 w-12 text-center">ลำดับ</th>
              <th className="px-3 py-2 text-left">รายการ / สูตรปุ๋ย</th>
              <th className="px-3 py-2 w-32 text-right">{priceHeaderLabel}</th>
              <th className="px-2 py-2 w-12 text-center border-l-2 border-gray-300">ลำดับ</th>
              <th className="px-3 py-2 text-left">รายการ / สูตรปุ๋ย</th>
              <th className="px-3 py-2 w-32 text-right">{priceHeaderLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {pairs.map((pair, idx) => (
              <tr key={idx} className="hover:bg-blue-50/30">
                {renderHalf(pair.left, false)}
                {renderHalf(pair.right, true)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SheetReportPreview({ layout }: { layout: SheetLayout }) {
  const isCost = layout.kind === 'costlist';
  const accentClass = isCost
    ? 'bg-rose-900 text-white'
    : 'bg-[#0C447C] text-white';

  return (
    <div className="p-4 sm:p-6 space-y-5 bg-white">
      {/* Official Sheet Title Header */}
      <div className="border-b-2 border-gray-800 pb-3 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            บริษัท เวิลด์ เฟอร์ติไลเซอร์ จำกัด (WORLD FERT CO., LTD.)
          </div>
          <h3 className={`text-lg font-black mt-0.5 ${isCost ? 'text-rose-900' : 'text-[#0C447C]'}`}>
            {layout.title}
          </h3>
          <div className="text-xs font-semibold text-gray-700 mt-1">{layout.periodSubtitle}</div>
        </div>
        <div className="text-xs text-gray-500 text-right">
          <div>พิมพ์เมื่อ: <span className="font-medium text-gray-700">{layout.generatedAt}</span></div>
          <div className="mt-0.5 text-[11px]">หน่วย: บาท / ตัน</div>
        </div>
      </div>

      {layout.mode === 'current' ? (
        <div className="space-y-5">
          <SheetSideBySideSection
            title="ปุ๋ยสูตร (Compound Fertilizer)"
            pairs={layout.compoundPairs || []}
            priceHeaderLabel={layout.priceHeaderLabel || 'ราคา/ตัน'}
            accentClass={accentClass}
          />
          <SheetSideBySideSection
            title="ปุ๋ยเดี่ยว / แม่ปุ๋ย (Straight / Raw Materials)"
            pairs={layout.singlePairs || []}
            priceHeaderLabel={layout.priceHeaderLabel || 'ราคา/ตัน'}
            accentClass={accentClass}
          />
          {(layout.compoundPairs?.length || 0) === 0 && (layout.singlePairs?.length || 0) === 0 && (
            <div className="py-12 text-center text-gray-400 text-xs border border-dashed border-gray-200 rounded-xl">
              ไม่มีรายการสินค้าในรอบราคาที่เลือก
            </div>
          )}
        </div>
      ) : (
        <div className="border border-gray-300 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100 text-gray-700 font-bold border-b border-gray-300">
                  <th className="px-3 py-2.5 text-left w-28">หมวด</th>
                  <th className="px-2 py-2.5 text-center w-12">ลำดับ</th>
                  <th className="px-3 py-2.5 text-left">รายการ / สูตรปุ๋ย</th>
                  {(layout.selectedPeriods || []).map(sp => (
                    <th
                      key={sp.key}
                      className={`px-3 py-2.5 text-right whitespace-nowrap ${
                        sp.isCurrent ? 'bg-blue-100/80 text-[#0C447C]' : ''
                      }`}
                    >
                      <div>{sp.offsetLabel}</div>
                      <div className="text-[10px] font-normal text-gray-600">{sp.shortLabel}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right whitespace-nowrap bg-amber-50/70">ส่วนต่าง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(layout.products || []).map((prod, idx) => {
                  const periods = layout.selectedPeriods || [];
                  const firstCell = periods[0] ? prod.byPeriod[periods[0].key] : null;
                  const lastCell = periods[periods.length - 1]
                    ? prod.byPeriod[periods[periods.length - 1].key]
                    : null;
                  const delta =
                    firstCell &&
                    lastCell &&
                    firstCell.lineStatus !== 'SUSPENDED' &&
                    lastCell.lineStatus !== 'SUSPENDED'
                      ? Number((lastCell.price - firstCell.price).toFixed(2))
                      : null;
                  return (
                    <tr key={`${prod.goodCode}-${idx}`} className="hover:bg-blue-50/20">
                      <td className="px-3 py-2 text-[11px] font-medium text-gray-600 whitespace-nowrap">
                        {prod.groupType === 'SINGLE' ? 'ปุ๋ยเดี่ยว/แม่ปุ๋ย' : 'ปุ๋ยสูตร'}
                      </td>
                      <td className="px-2 py-2 text-center text-gray-500 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2 font-semibold text-gray-900">{prod.goodName}</td>
                      {periods.map(sp => (
                        <td
                          key={sp.key}
                          className={`px-3 py-2 text-right whitespace-nowrap ${
                            sp.isCurrent ? 'bg-blue-50/50' : ''
                          }`}
                        >
                          {renderSheetPriceCell(prod.byPeriod[sp.key])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums font-bold bg-amber-50/30 whitespace-nowrap">
                        {delta === null ? (
                          <span className="text-gray-300">—</span>
                        ) : delta === 0 ? (
                          <span className="text-gray-500">0</span>
                        ) : (
                          <span className={delta > 0 ? 'text-emerald-700' : 'text-rose-700'}>
                            {delta > 0 ? `+${formatSheetMoney(delta)}` : formatSheetMoney(delta)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(layout.products || []).length === 0 && (
                  <tr>
                    <td colSpan={4 + (layout.selectedPeriods?.length || 0)} className="py-12 text-center text-gray-400">
                      ไม่มีข้อมูลสินค้าในช่วงที่เลือก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Special Prices Section (Pricelist only) */}
      {layout.kind === 'pricelist' && layout.specialPrices.length > 0 && (
        <div className="border border-blue-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-blue-50 text-[#0C447C] text-xs font-bold">
            ราคาพิเศษเฉพาะร้านค้า (Special Price) ({layout.specialPrices.length} รายการ)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left">ร้านค้า</th>
                  <th className="px-3 py-2 text-left">สูตรปุ๋ย</th>
                  <th className="px-3 py-2 text-right">ราคาพิเศษ/ตัน</th>
                  <th className="px-3 py-2 text-center">สถานะ</th>
                  <th className="px-3 py-2 text-left">เหตุผล</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {layout.specialPrices.map((sp, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium text-gray-800">
                      <span className="font-mono text-gray-500 mr-1.5">[{sp.custId}]</span>
                      {sp.custName}
                    </td>
                    <td className="px-3 py-2 text-gray-800">{sp.goodName}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-[#0C447C]">
                      {formatSheetMoney(sp.price)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        sp.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {sp.status === 'APPROVED' ? 'อนุมัติแล้ว' : 'รออนุมัติ'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{sp.reasonText || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footnote & Signatures */}
      <div className="pt-4 border-t border-gray-200 space-y-5">
        {layout.footnote && (
          <div className={`text-xs font-medium px-3 py-2 rounded-lg ${
            isCost ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-gray-50 text-gray-600'
          }`}>
            {layout.footnote}
          </div>
        )}
        <div className="grid grid-cols-2 gap-8 pt-2 max-w-2xl mx-auto text-center text-xs text-gray-700">
          <div className="space-y-8">
            <div className="border-b border-dotted border-gray-400 pt-8" />
            <div className="font-bold">({layout.signatures?.leftLabel || 'ฝ่ายขาย'})</div>
          </div>
          <div className="space-y-8">
            <div className="border-b border-dotted border-gray-400 pt-8" />
            <div className="font-bold">({layout.signatures?.rightLabel || 'ผู้อนุมัติ'})</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReportsPage() {
  const currentUser = useAuthStore(s => s.user);
  const isAdmin = currentUser?.role === 'ADMIN' || (Array.isArray(currentUser?.roles) && currentUser.roles.includes('ADMIN'));

  const [types, setTypes] = useState<ReportTypeItem[]>([]);
  const [active, setActive] = useState<string>('');
  const [data, setData] = useState<ReportData | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<ResolvedReportTemplateDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const [templateError, setTemplateError] = useState<string | null>(null);

  const refreshReportTypes = useCallback(() => {
    fetchReportTypes()
      .then(t => {
        setTypes(t);
        if (t.length > 0 && !t.some(x => x.key === active)) {
          setActive(t[0].key);
        }
      })
      .catch(console.error);
  }, [active]);

  // Guard against stale asynchronous responses
  const activeReqIdRef = useRef(0);

  // Default to today in Bangkok timezone (YYYY-MM-DD) and 60 days ago for from date
  const [from, setFrom] = useState(() => bangkokDate(60));
  const [to, setTo] = useState(() => bangkokDate(0));
  const isSheetReport = active === 'pricelist_sheet' || active === 'costlist_sheet';
  const needsDateRange = !isSheetReport;

  const [sheetMode, setSheetMode] = useState<'current' | 'compare'>('current');
  const [sheetGranularity, setSheetGranularity] = useState<'week' | 'month'>('week');
  const [sheetPeriods, setSheetPeriods] = useState<ReportPeriodItem[]>([]);
  const [selectedPeriodState, setSelectedPeriodState] = useState<{
    kind: 'pricelist' | 'costlist';
    granularity: 'week' | 'month';
    keys: string[];
  }>({ kind: 'pricelist', granularity: 'week', keys: [] });

  const CUST_FILTER_REPORTS = ['customer-dispatch'];
  const needsCustFilter = CUST_FILTER_REPORTS.includes(active);
  const [custCode, setCustCode] = useState('');

  // บันทึกเอกสาร WinSpeed: เลือกสาย I (บัญชี 1) หรือ K (บัญชี 2) ได้
  const BOOK_FILTER_REPORTS = ['native-documents'];
  const needsBookFilter = BOOK_FILTER_REPORTS.includes(active);
  const [book, setBook] = useState('');

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

  useEffect(() => {
    if (!isSheetReport) return;
    const kind: 'pricelist' | 'costlist' = active === 'costlist_sheet' ? 'costlist' : 'pricelist';
    let cancelled = false;
    fetchReportPeriods(kind, sheetGranularity)
      .then(res => {
        if (cancelled) return;
        const periods = (res.periods || []).filter(p => p.offset >= -2 && p.offset <= 2);
        setSheetPeriods(periods);
        const cur = periods.find(p => p.isCurrent) || periods[periods.length - 1];
        setSelectedPeriodState({
          kind,
          granularity: sheetGranularity,
          keys: sheetMode === 'current'
            ? (cur ? [cur.key] : [])
            : periods.map(p => p.key),
        });
      })
      .catch(err => {
        if (!cancelled) console.error('Failed to load sheet periods:', err);
      });
    return () => { cancelled = true; };
  }, [isSheetReport, active, sheetGranularity, sheetMode]);

  const reportParams = useCallback((): Record<string, string> | undefined => {
    const p: Record<string, string> = {};
    if (isSheetReport) {
      const kind: 'pricelist' | 'costlist' = active === 'costlist_sheet' ? 'costlist' : 'pricelist';
      p.mode = sheetMode;
      p.granularity = sheetGranularity;
      if (
        sheetMode === 'compare' &&
        selectedPeriodState.kind === kind &&
        selectedPeriodState.granularity === sheetGranularity &&
        selectedPeriodState.keys.length > 0
      ) {
        p.periodIds = selectedPeriodState.keys.join(',');
      }
      return p;
    }
    if (from) p.from = from;
    if (to) p.to = to;
    if (CUST_FILTER_REPORTS.includes(active) && custCode.trim()) {
      p.custCode = custCode.trim();
    }
    if (BOOK_FILTER_REPORTS.includes(active) && book) {
      p.book = book;
    }
    return Object.keys(p).length ? p : undefined;
  }, [active, isSheetReport, sheetMode, sheetGranularity, selectedPeriodState, from, to, custCode, book]);

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
      void appAlert((e as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  }

  function handleTogglePeriod(target: ReportPeriodItem) {
    if (sheetMode === 'current') return;
    const kind: 'pricelist' | 'costlist' = active === 'costlist_sheet' ? 'costlist' : 'pricelist';
    const curKeys =
      selectedPeriodState.kind === kind && selectedPeriodState.granularity === sheetGranularity
        ? selectedPeriodState.keys
        : [];
    const exists = curKeys.includes(target.key);
    const nextKeys = exists ? curKeys.filter(k => k !== target.key) : [...curKeys, target.key];
    if (nextKeys.length === 0) {
      void appAlert('ต้องเลือกอย่างน้อย 1 รอบสำหรับเปรียบเทียบ', 'info');
      return;
    }
    const chosen = sheetPeriods
      .filter(p => nextKeys.includes(p.key))
      .sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < chosen.length; i++) {
      if (chosen[i].offset - chosen[i - 1].offset !== 1) {
        void appAlert('กรุณาเลือกรอบเปรียบเทียบที่เรียงต่อเนื่องกัน (ห้ามข้ามรอบ เช่น -1 แล้วไป +1) และอยู่ภายในช่วง -2 ถึง +2 รอบ', 'info');
        return;
      }
    }
    setSelectedPeriodState({
      kind,
      granularity: sheetGranularity,
      keys: chosen.map(p => p.key),
    });
  }

  function applyContiguousPreset(filterFn: (p: ReportPeriodItem) => boolean) {
    const kind: 'pricelist' | 'costlist' = active === 'costlist_sheet' ? 'costlist' : 'pricelist';
    const chosen = sheetPeriods.filter(filterFn).sort((a, b) => a.offset - b.offset);
    if (!chosen.length) return;
    setSelectedPeriodState({
      kind,
      granularity: sheetGranularity,
      keys: chosen.map(p => p.key),
    });
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

          {needsBookFilter && (
            <select
              value={book}
              onChange={e => setBook(e.target.value)}
              title="สายเอกสาร"
              className="h-10 px-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">ทุกสาย</option>
              <option value="I">สาย I (บัญชี 1)</option>
              <option value="K">สาย K (บัญชี 2)</option>
            </select>
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
          <SearchableSelect
            value={active}
            onChange={(val) => { if (val) setActive(val); }}
            placeholder="เลือกรายงาน..."
            searchPlaceholder="ค้นหารายงาน..."
            options={types.map(t => ({
              value: t.key,
              label: t.title,
              badge: t.category ? (CATEGORY_MAP[t.category] || t.category) : undefined,
            }))}
          />
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
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    active === t.key
                      ? 'bg-[#0C447C] text-white shadow-sm'
                      : t.enabled === false
                      ? 'text-gray-400 bg-gray-50 hover:bg-gray-100/80 opacity-75'
                      : 'text-gray-700 hover:bg-gray-100/80'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileSpreadsheet size={15} className="shrink-0 opacity-80" />
                    <span className="truncate">{t.title}</span>
                  </div>
                  {isAdmin && t.enabled === false && (
                    <span className="text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold shrink-0">
                      ปิด
                    </span>
                  )}
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
                <div className="flex items-center gap-2">
                  {data.meta?.isTruncated && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                      แสดงข้อมูลบางส่วน
                    </span>
                  )}
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-800 border border-blue-100">
                    {data.rows.length.toLocaleString('th-TH')} แถว
                  </span>
                </div>
              </div>

              {/* Truncation Warning Banner */}
              {data.meta?.isTruncated && (
                <div className="mx-5 my-3 p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl flex items-center justify-between gap-3 text-xs shadow-xs">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle size={16} className="text-amber-600 shrink-0" />
                    <span>
                      <b>⚠️ ข้อมูลแสดงบางส่วน (Partial Display):</b> รายงานถูกจำกัดที่ {data.meta.voucherCount || data.rows.length} ใบสำคัญ (จากทั้งหมด {data.meta.totalMatchingVouchers || 'หลาย'} ใบสำคัญ){data.meta.page ? ` [หน้า ${data.meta.page}${data.meta.totalPages ? `/${data.meta.totalPages}` : ''}]` : ''} กรุณาระบุช่วงวันที่ให้แคบลง หรือใช้ตัวกรองเพื่อดูข้อมูลครบถ้วน
                    </span>
                  </div>
                  <span className="px-2.5 py-1 bg-amber-200 text-amber-950 font-bold rounded-lg text-[11px] shrink-0">
                    จำกัดสูงสุด {data.meta.voucherLimit || 2000} ใบ
                  </span>
                </div>
              )}

              {Boolean(data.meta?.missingDetailCount && data.meta.missingDetailCount > 0) && (
                <div className="mx-5 my-2 p-3 bg-red-50 border border-red-200 text-red-900 rounded-xl flex items-center justify-between gap-3 text-xs shadow-xs">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle size={16} className="text-red-600 shrink-0" />
                    <span>
                      <b>⚠️ ข้อมูลรายละเอียดไม่สมบูรณ์:</b> พบ {data.meta?.missingDetailCount} ใบสำคัญที่ไม่มีรายการบัญชีแยกประเภท (GLDT) ในฐานข้อมูล
                    </span>
                  </div>
                  <span className="px-2.5 py-1 bg-red-100 text-red-800 font-bold rounded-lg text-[11px] shrink-0 font-mono">
                    {data.meta?.missingDetailVouchers?.map(v => v.JournalNo).filter(Boolean).slice(0, 3).join(', ')}
                    {(data.meta?.missingDetailVouchers?.length || 0) > 3 ? '...' : ''}
                  </span>
                </div>
              )}

              {/* Sheet Controls (-2..+2 Contiguous Period Picker) for Pricelist / Costlist */}
              {isSheetReport && (
                <div className="px-5 py-3 bg-slate-50 border-b border-gray-200 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex rounded-xl bg-white border border-gray-200 p-0.5 shadow-xs">
                        <button
                          type="button"
                          onClick={() => setSheetMode('current')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            sheetMode === 'current'
                              ? 'bg-[#0C447C] text-white'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          เฉพาะรอบปัจจุบัน
                        </button>
                        <button
                          type="button"
                          onClick={() => setSheetMode('compare')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            sheetMode === 'compare'
                              ? 'bg-[#0C447C] text-white'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          เปรียบเทียบ (-2..+2 รอบ)
                        </button>
                      </div>

                      <div className="inline-flex rounded-xl bg-white border border-gray-200 p-0.5 shadow-xs">
                        <button
                          type="button"
                          onClick={() => setSheetGranularity('week')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            sheetGranularity === 'week'
                              ? 'bg-emerald-700 text-white'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          รายสัปดาห์ / รอบตาราง
                        </button>
                        <button
                          type="button"
                          onClick={() => setSheetGranularity('month')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            sheetGranularity === 'month'
                              ? 'bg-emerald-700 text-white'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          รายเดือน
                        </button>
                      </div>
                    </div>

                    {sheetMode === 'compare' && sheetPeriods.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-gray-500 font-medium">ชุดด่วน:</span>
                        <button
                          type="button"
                          onClick={() => applyContiguousPreset(() => true)}
                          className="px-2 py-1 rounded-lg bg-white border border-gray-200 hover:border-blue-400 text-gray-700 font-semibold cursor-pointer"
                        >
                          ทั้งหมด (-2..+2)
                        </button>
                        <button
                          type="button"
                          onClick={() => applyContiguousPreset(p => p.offset >= -1 && p.offset <= 1)}
                          className="px-2 py-1 rounded-lg bg-white border border-gray-200 hover:border-blue-400 text-gray-700 font-semibold cursor-pointer"
                        >
                          -1..0..+1
                        </button>
                        <button
                          type="button"
                          onClick={() => applyContiguousPreset(p => p.offset <= 0)}
                          className="px-2 py-1 rounded-lg bg-white border border-gray-200 hover:border-blue-400 text-gray-700 font-semibold cursor-pointer"
                        >
                          ย้อนหลัง (-2..0)
                        </button>
                        <button
                          type="button"
                          onClick={() => applyContiguousPreset(p => p.offset >= 0)}
                          className="px-2 py-1 rounded-lg bg-white border border-gray-200 hover:border-blue-400 text-gray-700 font-semibold cursor-pointer"
                        >
                          ล่วงหน้า (0..+2)
                        </button>
                      </div>
                    )}
                  </div>

                  {sheetMode === 'compare' && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-gray-600 mr-1">
                        เลือกรอบต่อเนื่อง (ช่วง -2 ถึง +2):
                      </span>
                      {sheetPeriods.length === 0 ? (
                        <span className="text-xs text-gray-400">ไม่มีรอบข้อมูลสำหรับเปรียบเทียบ</span>
                      ) : (
                        sheetPeriods.map(p => {
                          const isChecked =
                            selectedPeriodState.keys.includes(p.key);
                          return (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => handleTogglePeriod(p)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer flex items-center gap-1.5 ${
                                isChecked
                                  ? p.isCurrent
                                    ? 'bg-[#0C447C] text-white border-[#0C447C] shadow-xs'
                                    : 'bg-blue-50 text-blue-900 border-blue-400'
                                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              <span className={`px-1 rounded text-[10px] font-mono ${
                                isChecked ? 'bg-black/15' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {p.offsetLabel}
                              </span>
                              <span>{p.shortLabel || p.label}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sheet Layout Preview OR Standard Data Table */}
              {data.meta?.sheetLayout ? (
                <SheetReportPreview layout={data.meta.sheetLayout} />
              ) : (
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
