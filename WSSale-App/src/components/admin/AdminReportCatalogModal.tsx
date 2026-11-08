import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { unsavedMessage } from '../../utils/unsaved-changes';
import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  RotateCcw,
  Save,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  SlidersHorizontal,
  FileSpreadsheet,
  ListOrdered
} from 'lucide-react';
import {
  fetchReportCatalogConfig,
  saveReportCatalogConfig,
  type ReportCatalogConfigItem
} from '../../services/api';

interface AdminReportCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCatalogUpdated: () => void;
}

const CATEGORY_NAMES: Record<string, string> = {
  all: 'ทั้งหมด',
  sales: 'งานขาย',
  logistics: 'คลัง/เอกสาร',
  weighing: 'การชั่ง',
  rebate: 'รีเบท',
  finance: 'การเงิน/บัญชี',
  audit: 'ตรวจสอบ/Audit',
  ops: 'ปฏิบัติการ',
  general: 'ทั่วไป'
};

export const AdminReportCatalogModal: React.FC<AdminReportCatalogModalProps> = ({
  isOpen,
  onClose,
  onCatalogUpdated,
}) => {
  const [items, setItems] = useState<ReportCatalogConfigItem[]>([]);
  const [baseline, setBaseline] = useState('');
  const signature = (rows: ReportCatalogConfigItem[]) => JSON.stringify(rows.map(r => [r.key, r.enabled]));
  const dirty = Boolean(baseline && baseline !== signature(items));
  useUnsavedChanges(isOpen && dirty);
  const requestClose = () => { if (!saving && (!dirty || window.confirm(unsavedMessage))) onClose(); };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  useEffect(() => {
    if (!isOpen) return;
    loadCatalog();
  }, [isOpen]);

  async function loadCatalog() {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetchReportCatalogConfig();
      setItems(res.reports || []);
      setBaseline(signature(res.reports || []));
    } catch (err: any) {
      console.error('Failed to load report catalog config:', err);
      setError(err?.message || 'ไม่สามารถโหลดข้อมูลแคตตาล็อกรายงานได้');
    } finally {
      setLoading(false);
    }
  }

  // Move item in array
  const moveItem = (index: number, direction: 'up' | 'down' | 'top' | 'bottom') => {
    setItems(prev => {
      const next = [...prev];
      if (direction === 'top') {
        const [moved] = next.splice(index, 1);
        next.unshift(moved);
      } else if (direction === 'bottom') {
        const [moved] = next.splice(index, 1);
        next.push(moved);
      } else if (direction === 'up' && index > 0) {
        const temp = next[index - 1];
        next[index - 1] = next[index];
        next[index] = temp;
      } else if (direction === 'down' && index < next.length - 1) {
        const temp = next[index + 1];
        next[index + 1] = next[index];
        next[index] = temp;
      }
      return next;
    });
  };

  // Toggle visibility of item
  const toggleVisibility = (key: string) => {
    setItems(prev =>
      prev.map(item =>
        item.key === key ? { ...item, enabled: !item.enabled } : item
      )
    );
  };

  // Reset to original alphabetical / default order
  const handleReset = () => {
    if (!confirm('ต้องการรีเซ็ตลำดับรายงานและเปิดการแสดงผลทั้งหมดเป็นค่าเริ่มต้นใช่หรือไม่?')) return;
    setItems(prev =>
      [...prev]
        .sort((a, b) => a.title.localeCompare(b.title, 'th'))
        .map(i => ({ ...i, enabled: true }))
    );
  };

  // Save changes to backend
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const order = items.map(i => i.key);
      const visibility: Record<string, boolean> = {};
      items.forEach(i => {
        visibility[i.key] = i.enabled;
      });

      await saveReportCatalogConfig({ order, visibility });
      setSuccessMsg('บันทึกการจัดเรียงลำดับและเปิด/ปิดรายงานเรียบร้อยแล้ว');
      setBaseline(signature(items));
      onCatalogUpdated();
      setTimeout(() => {
        setSuccessMsg(null);
      }, 3000);
    } catch (err: any) {
      console.error('Failed to save report catalog config:', err);
      setError(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  // Filter items for display
  const filteredIndices = useMemo(() => {
    const list: number[] = [];
    items.forEach((item, idx) => {
      const matchSearch =
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.key.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCat =
        selectedCategory === 'all' || (item.category || 'general') === selectedCategory;
      if (matchSearch && matchCat) {
        list.push(idx);
      }
    });
    return list;
  }, [items, searchTerm, selectedCategory]);

  const enabledCount = useMemo(() => items.filter(i => i.enabled).length, [items]);
  const disabledCount = items.length - enabledCount;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div inert={saving} className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-900 to-[#0C447C] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-md">
              <SlidersHorizontal className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">จัดการการแสดงผลรายงาน (Report Catalog)</h2>
                <span className="text-[10px] bg-amber-400 text-amber-950 font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Admin Only
                </span>
              </div>
              <p className="text-xs text-blue-100/80 mt-0.5">
                จัดเรียงลำดับการแสดงผล และเปิด/ปิด การเข้าถึงรายงานต่างๆ ทั้งระบบ (มีผลกับผู้ใช้งานทุกคนทันที)
              </p>
            </div>
          </div>
          <button
            onClick={requestClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Toolbar & Stats Bar */}
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
              <input
                type="text"
                placeholder="ค้นหารายงานหรือคีย์..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
            >
              {Object.entries(CATEGORY_NAMES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-xs font-medium">
            <span className="text-gray-500">
              รายงานทั้งหมด: <b className="text-gray-900">{items.length}</b>
            </span>
            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              เปิด: <b>{enabledCount}</b>
            </span>
            <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
              ปิด: <b>{disabledCount}</b>
            </span>
          </div>
        </div>

        {/* Status Alerts */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Content Table / List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-20 text-center text-gray-400 text-sm">กำลังโหลดข้อมูลแคตตาล็อกรายงาน...</div>
          ) : filteredIndices.length === 0 ? (
            <div className="py-20 text-center text-gray-400 text-sm">ไม่พบรายงานที่ตรงกับคำค้นหา</div>
          ) : (
            filteredIndices.map(itemIndex => {
              const item = items[itemIndex];
              const isFirst = itemIndex === 0;
              const isLast = itemIndex === items.length - 1;

              return (
                <div
                  key={item.key}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                    item.enabled
                      ? 'bg-white border-gray-200 hover:border-blue-300 shadow-2xs'
                      : 'bg-gray-50 border-gray-200 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                    {/* Index Badge */}
                    <div className="h-7 w-7 rounded-lg bg-blue-50 text-[#0C447C] font-mono text-xs font-bold flex items-center justify-center shrink-0 border border-blue-100">
                      {itemIndex + 1}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 truncate">
                          {item.title}
                        </span>
                        {!item.available && (
                          <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                            ยังไม่มี native code
                          </span>
                        )}
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                          {CATEGORY_NAMES[item.category] || item.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono truncate">{item.key}</div>
                    </div>
                  </div>

                  {/* Right side controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Move buttons */}
                    <div className="flex items-center bg-gray-100 rounded-lg p-0.5 border border-gray-200">
                      <button
                        type="button"
                        onClick={() => moveItem(itemIndex, 'top')}
                        disabled={isFirst}
                        title="ย้ายไปบนสุด"
                        className="p-1 text-gray-600 hover:text-[#0C447C] hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronsUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(itemIndex, 'up')}
                        disabled={isFirst}
                        title="ย้ายขึ้น 1 ลำดับ"
                        className="p-1 text-gray-600 hover:text-[#0C447C] hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(itemIndex, 'down')}
                        disabled={isLast}
                        title="ย้ายลง 1 ลำดับ"
                        className="p-1 text-gray-600 hover:text-[#0C447C] hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(itemIndex, 'bottom')}
                        disabled={isLast}
                        title="ย้ายไปล่างสุด"
                        className="p-1 text-gray-600 hover:text-[#0C447C] hover:bg-white rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronsDown size={14} />
                      </button>
                    </div>

                    {/* Enable / Disable toggle switch */}
                    <button
                      type="button"
                      onClick={() => toggleVisibility(item.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                        item.enabled
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                      }`}
                    >
                      {item.enabled ? (
                        <>
                          <Eye size={13} />
                          <span>เปิดใช้งาน</span>
                        </>
                      ) : (
                        <>
                          <EyeOff size={13} />
                          <span>ปิดการแสดงผล</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-200/80 rounded-lg transition-colors"
          >
            <RotateCcw size={14} />
            <span>รีเซ็ตเป็นค่าเริ่มต้น</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-[#0C447C] hover:bg-[#0a3866] rounded-lg transition-all shadow-sm disabled:opacity-50"
            >
              <Save size={14} />
              <span>{saving ? 'กำลังบันทึก...' : 'บันทึกการจัดเรียง & เปิด/ปิด'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
