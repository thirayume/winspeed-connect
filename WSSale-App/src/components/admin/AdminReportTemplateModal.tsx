import React, { useState, useEffect, useCallback } from 'react';
import { X, Building2, Layers, CheckCircle2, History, Plus, Edit2, Save, AlertCircle, RefreshCw, ShieldCheck, Tag } from 'lucide-react';
import {
  fetchAdminReportHeaders,
  createAdminReportHeader,
  updateAdminReportHeader,
  fetchAdminReportTemplates,
  createAdminReportTemplate,
  updateAdminReportTemplate,
  fetchAdminReportAssignments,
  updateAdminReportAssignment,
  fetchAdminReportAudit,
  type ReportHeaderMasterItem,
  type ReportTemplateItem,
  type ReportAssignmentItem,
  type ReportAuditEventItem
} from '../../services/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onTemplateUpdated?: () => void;
}

export function AdminReportTemplateModal({ isOpen, onClose, onTemplateUpdated }: Props) {
  const [activeTab, setActiveTab] = useState<'headers' | 'templates' | 'assignments' | 'audit'>('headers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Data states
  const [headers, setHeaders] = useState<ReportHeaderMasterItem[]>([]);
  const [templates, setTemplates] = useState<ReportTemplateItem[]>([]);
  const [assignments, setAssignments] = useState<ReportAssignmentItem[]>([]);
  const [audits, setAudits] = useState<ReportAuditEventItem[]>([]);

  // Edit / Form states
  const [editingHeader, setEditingHeader] = useState<Partial<ReportHeaderMasterItem> | null>(null);
  const [isNewHeader, setIsNewHeader] = useState(false);

  const [editingTemplate, setEditingTemplate] = useState<Partial<ReportTemplateItem> | null>(null);
  const [isNewTemplate, setIsNewTemplate] = useState(false);

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, t, a, au] = await Promise.all([
        fetchAdminReportHeaders(),
        fetchAdminReportTemplates(),
        fetchAdminReportAssignments(),
        fetchAdminReportAudit(50)
      ]);
      setHeaders(h);
      setTemplates(t);
      setAssignments(a);
      setAudits(au);
    } catch (err: any) {
      console.error('Failed to load admin report data:', err);
      setError(err?.message || 'โหลดข้อมูลเทมเพลตไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3500);
  };

  // ── Header Master Actions ─────────────────────────────────────────────────
  const handleSaveHeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHeader) return;
    if (!reason.trim()) {
      alert('ต้องระบุเหตุผลในการแก้ไข/สร้างข้อมูลหัวกระดาษ (Reason is required)');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (isNewHeader) {
        await createAdminReportHeader({ ...editingHeader, reason: reason.trim() });
        showSuccess('สร้างหัวกระดาษสำเร็จ');
      } else if (editingHeader.HeaderId) {
        await updateAdminReportHeader(editingHeader.HeaderId, {
          ...editingHeader,
          expectedVersion: Number(editingHeader.Version || 1),
          reason: reason.trim()
        });
        showSuccess('บันทึกการแก้ไขหัวกระดาษและบันทึกประวัติสำเร็จ');
      }
      setEditingHeader(null);
      setIsNewHeader(false);
      setReason('');
      await loadData();
      onTemplateUpdated?.();
    } catch (err: any) {
      if (err?.status === 409 || String(err?.message || '').includes('Version Conflict') || String(err?.message || '').includes('ถูกแก้ไขโดยผู้อื่น')) {
        setError('ข้อมูลหัวกระดาษถูกแก้ไขโดยผู้อื่นแล้ว (Version Conflict) ระบบได้โหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบแล้วดำเนินการใหม่อีกครั้ง');
        await loadData();
      } else {
        setError(err?.message || 'บันทึกข้อมูลหัวกระดาษไม่สำเร็จ');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Template Actions ──────────────────────────────────────────────────────
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;
    if (!reason.trim()) {
      alert('ต้องระบุเหตุผลในการแก้ไข/สร้างแม่แบบรายงาน (Reason is required)');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (isNewTemplate) {
        await createAdminReportTemplate({ ...editingTemplate, reason: reason.trim() });
        showSuccess('สร้างแม่แบบรายงานสำเร็จ');
      } else if (editingTemplate.TemplateId) {
        await updateAdminReportTemplate(editingTemplate.TemplateId, {
          ...editingTemplate,
          expectedVersion: Number(editingTemplate.Version || 1),
          reason: reason.trim()
        });
        showSuccess('บันทึกการแก้ไขแม่แบบและบันทึกประวัติสำเร็จ');
      }
      setEditingTemplate(null);
      setIsNewTemplate(false);
      setReason('');
      await loadData();
      onTemplateUpdated?.();
    } catch (err: any) {
      if (err?.status === 409 || String(err?.message || '').includes('Version Conflict') || String(err?.message || '').includes('ถูกแก้ไขโดยผู้อื่น')) {
        setError('ข้อมูลแม่แบบรายงานถูกแก้ไขโดยผู้อื่นแล้ว (Version Conflict) ระบบได้โหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบแล้วดำเนินการใหม่อีกครั้ง');
        await loadData();
      } else {
        setError(err?.message || 'บันทึกแม่แบบรายงานไม่สำเร็จ');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Assignment Actions ────────────────────────────────────────────────────
  const handleUpdateAssignment = async (reportKey: string, templateId: number) => {
    const rPrompt = prompt(`ระบุเหตุผลในการเปลี่ยนแม่แบบสำหรับรายงาน "${reportKey}":`);
    if (!rPrompt || !rPrompt.trim()) {
      alert('การแก้ไขการกำหนดแม่แบบต้องระบุเหตุผลเสมอ');
      return;
    }

    const cur = assignments.find(a => a.ReportKey === reportKey);
    setLoading(true);
    setError(null);
    try {
      await updateAdminReportAssignment(reportKey, {
        templateId,
        isActive: true,
        expectedVersion: cur?.Version,
        reason: rPrompt.trim()
      });
      showSuccess(`กำหนดแม่แบบสำหรับรายงาน ${reportKey} สำเร็จ`);
      await loadData();
      onTemplateUpdated?.();
    } catch (err: any) {
      if (err?.status === 409 || String(err?.message || '').includes('Version Conflict') || String(err?.message || '').includes('ถูกแก้ไขโดยผู้อื่น')) {
        setError('การกำหนดแม่แบบรายงานนี้ถูกแก้ไขโดยผู้อื่นแล้ว (Version Conflict) ระบบได้โหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบแล้วดำเนินการใหม่อีกครั้ง');
        await loadData();
      } else {
        setError(err?.message || 'กำหนดแม่แบบไม่สำเร็จ');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden border border-gray-100">
        
        {/* Top Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#0C447C] to-[#184E88] text-white flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-xs">
              <Building2 size={22} className="text-blue-100" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">ระบบจัดการหัวกระดาษและแม่แบบรายงาน (SO-10 Admin Master)</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-amber-950 uppercase">Admin Only</span>
              </div>
              <p className="text-xs text-blue-100/90 mt-0.5">
                ศูนย์กลางกำหนดหัวกระดาษบริษัท, แม่แบบรายงานหลายรูปแบบ, กำหนดรายงานตัวแทน และตรวจสอบ Audit Trail
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

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-gray-200 bg-gray-50/80 flex items-center justify-between">
          <div className="flex space-x-1 sm:space-x-4">
            <button
              onClick={() => { setActiveTab('headers'); setEditingHeader(null); }}
              className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'headers'
                  ? 'border-[#0C447C] text-[#0C447C]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Building2 size={16} /> หัวกระดาษหลัก ({headers.length})
            </button>
            <button
              onClick={() => { setActiveTab('templates'); setEditingTemplate(null); }}
              className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'templates'
                  ? 'border-[#0C447C] text-[#0C447C]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Layers size={16} /> แม่แบบรายงาน ({templates.length})
            </button>
            <button
              onClick={() => setActiveTab('assignments')}
              className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'assignments'
                  ? 'border-[#0C447C] text-[#0C447C]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Tag size={16} /> กำหนดแม่แบบรายงาน ({assignments.length})
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'audit'
                  ? 'border-[#0C447C] text-[#0C447C]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <History size={16} /> ประวัติการแก้ไข (Audit Trail)
            </button>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 text-gray-500 hover:text-[#0C447C] rounded-lg hover:bg-white transition-colors cursor-pointer"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Feedback Alerts */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <div className="flex-1 font-medium">{error}</div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-xs font-bold">ปิด</button>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
            <div className="flex-1 font-medium">{successMsg}</div>
          </div>
        )}

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-gray-50/40">

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 1: HEADER MASTERS                                         */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'headers' && (
            <div>
              {editingHeader ? (
                <form onSubmit={handleSaveHeader} className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b pb-3">
                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                      <Building2 size={16} className="text-[#0C447C]" />
                      {isNewHeader ? 'เพิ่มข้อมูลหัวกระดาษบริษัทใหม่' : `แก้ไขหัวกระดาษ: ${editingHeader.HeaderName} (v${editingHeader.Version})`}
                    </h3>
                    <button
                      type="button"
                      onClick={() => { setEditingHeader(null); setIsNewHeader(false); }}
                      className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">รหัสหัวกระดาษ (Header Code) *</label>
                      <input
                        type="text"
                        value={editingHeader.HeaderCode || ''}
                        disabled={!isNewHeader}
                        onChange={e => setEditingHeader({ ...editingHeader, HeaderCode: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg bg-gray-50 font-mono disabled:opacity-60"
                        placeholder="เช่น CORP_HQ, FACTORY_LOGISTICS"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ชื่อเรียกหัวกระดาษ (Header Name) *</label>
                      <input
                        type="text"
                        value={editingHeader.HeaderName || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, HeaderName: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="เช่น สำนักงานใหญ่ (World Fert HQ)"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ชื่อบริษัท (ภาษาไทย) *</label>
                      <input
                        type="text"
                        value={editingHeader.CompanyNameTh || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, CompanyNameTh: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg font-medium"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ชื่อบริษัท (ภาษาอังกฤษ)</label>
                      <input
                        type="text"
                        value={editingHeader.CompanyNameEn || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, CompanyNameEn: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ชื่อสาขา</label>
                      <input
                        type="text"
                        value={editingHeader.BranchNameTh || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, BranchNameTh: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="เช่น สำนักงานใหญ่ หรือ สาขาโรงงานนครปฐม"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">รหัสสาขา (Branch Code)</label>
                      <input
                        type="text"
                        value={editingHeader.BranchCode || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, BranchCode: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg font-mono"
                        placeholder="เช่น 00000 หรือ 00001"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-gray-700 mb-1">ที่อยู่บริษัท (ภาษาไทย) *</label>
                      <textarea
                        rows={2}
                        value={editingHeader.AddressTh || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, AddressTh: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">เบอร์โทรศัพท์</label>
                      <input
                        type="text"
                        value={editingHeader.Tel || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, Tel: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">เบอร์โทรสาร (Fax)</label>
                      <input
                        type="text"
                        value={editingHeader.Fax || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, Fax: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">เลขประจำตัวผู้เสียภาษี (Tax ID) *</label>
                      <input
                        type="text"
                        value={editingHeader.TaxId || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, TaxId: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg font-mono font-medium"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ข้อความท้ายเอกสาร (Footer Note)</label>
                      <input
                        type="text"
                        value={editingHeader.FooterNote || ''}
                        onChange={e => setEditingHeader({ ...editingHeader, FooterNote: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="เช่น เอกสารนี้ออกโดยระบบอัตโนมัติ..."
                      />
                    </div>
                  </div>

                  {/* Mandatory Reason Box */}
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-1">
                    <label className="block font-bold text-amber-900 text-xs flex items-center gap-1.5">
                      <ShieldCheck size={14} className="text-amber-700" /> เหตุผลในการแก้ไข/สร้างข้อมูล (Audit Log Reason) *
                    </label>
                    <input
                      type="text"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลงตามมาตรฐาน SO-10"
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-500"
                      required
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <button
                      type="button"
                      onClick={() => { setEditingHeader(null); setIsNewHeader(false); }}
                      className="px-4 py-2 border rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-5 py-2 rounded-lg text-xs font-semibold bg-[#0C447C] text-white hover:bg-[#184E88] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Save size={14} /> {submitting ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-gray-800 text-sm">รายการหัวกระดาษบริษัทในระบบ</h3>
                      <p className="text-xs text-gray-500">ข้อมูลหัวกระดาษที่เป็นทางการสำหรับใช้พิมพ์รายงานและส่งออกเอกสาร</p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingHeader({
                          HeaderCode: '',
                          HeaderName: '',
                          CompanyNameTh: 'บริษัท เวิลด์ เฟอท จำกัด',
                          CompanyNameEn: 'WORLD FERT CO., LTD.',
                          AddressTh: '',
                          TaxId: '0105531024397',
                          Version: 1,
                          IsActive: true
                        });
                        setIsNewHeader(true);
                        setReason('');
                      }}
                      className="px-3.5 py-2 bg-[#0C447C] hover:bg-[#184E88] text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Plus size={14} /> เพิ่มหัวกระดาษใหม่
                    </button>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100/80 text-gray-700 border-b font-semibold">
                          <th className="py-2.5 px-3">รหัส</th>
                          <th className="py-2.5 px-3">ชื่อหัวกระดาษ / สาขา</th>
                          <th className="py-2.5 px-3">เลขผู้เสียภาษี</th>
                          <th className="py-2.5 px-3 text-center">Version</th>
                          <th className="py-2.5 px-3 text-center">สถานะ</th>
                          <th className="py-2.5 px-3 text-right">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {headers.map(h => (
                          <tr key={h.HeaderId} className="hover:bg-blue-50/30 transition-colors">
                            <td className="py-2.5 px-3 font-mono font-bold text-[#0C447C]">{h.HeaderCode}</td>
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-gray-800">{h.HeaderName}</div>
                              <div className="text-[11px] text-gray-500 truncate max-w-sm">{h.AddressTh}</div>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-gray-700">{h.TaxId}</td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                                v{h.Version}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                h.IsActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'
                              }`}>
                                {h.IsActive ? 'เปิดใช้งาน' : 'ปิด'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() => {
                                  setEditingHeader(h);
                                  setIsNewHeader(false);
                                  setReason('');
                                }}
                                className="px-2.5 py-1 text-xs font-medium text-[#0C447C] hover:bg-blue-50 rounded-md inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Edit2 size={13} /> แก้ไข
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 2: REPORT TEMPLATES                                       */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'templates' && (
            <div>
              {editingTemplate ? (
                <form onSubmit={handleSaveTemplate} className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b pb-3">
                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                      <Layers size={16} className="text-[#0C447C]" />
                      {isNewTemplate ? 'เพิ่มแม่แบบรายงานใหม่' : `แก้ไขแม่แบบ: ${editingTemplate.TemplateName} (v${editingTemplate.Version})`}
                    </h3>
                    <button
                      type="button"
                      onClick={() => { setEditingTemplate(null); setIsNewTemplate(false); }}
                      className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">รหัสแม่แบบ (Template Code) *</label>
                      <input
                        type="text"
                        value={editingTemplate.TemplateCode || ''}
                        disabled={!isNewTemplate}
                        onChange={e => setEditingTemplate({ ...editingTemplate, TemplateCode: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg bg-gray-50 font-mono disabled:opacity-60"
                        placeholder="เช่น TPL_LOGISTICS_DISPATCH"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ชื่อแม่แบบ (Template Name) *</label>
                      <input
                        type="text"
                        value={editingTemplate.TemplateName || ''}
                        onChange={e => setEditingTemplate({ ...editingTemplate, TemplateName: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">หัวกระดาษที่ผูก (Header Master) *</label>
                      <select
                        value={editingTemplate.HeaderId || ''}
                        onChange={e => setEditingTemplate({ ...editingTemplate, HeaderId: Number(e.target.value) })}
                        className="w-full px-3 py-2 border rounded-lg bg-white"
                        required
                      >
                        <option value="">-- เลือกหัวกระดาษ --</option>
                        {headers.map(h => (
                          <option key={h.HeaderId} value={h.HeaderId}>
                            {h.HeaderName} ({h.HeaderCode})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ทิศทางกระดาษ (Orientation)</label>
                      <select
                        value={editingTemplate.Orientation || 'portrait'}
                        onChange={e => setEditingTemplate({ ...editingTemplate, Orientation: e.target.value as any })}
                        className="w-full px-3 py-2 border rounded-lg bg-white"
                      >
                        <option value="portrait">แนวตั้ง (Portrait · A4)</option>
                        <option value="landscape">แนวนอน (Landscape · A4)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ลายมือชื่อ 1 (ฝ่ายขาย/ผู้ขอ)</label>
                      <input
                        type="text"
                        value={editingTemplate.SignatureSalesLabel || ''}
                        onChange={e => setEditingTemplate({ ...editingTemplate, SignatureSalesLabel: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="พนักงานขาย หรือ ผู้ยื่นคำขอ"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ลายมือชื่อ 2 (ผู้อนุมัติ/ผู้จัดการ)</label>
                      <input
                        type="text"
                        value={editingTemplate.SignatureApprovedLabel || ''}
                        onChange={e => setEditingTemplate({ ...editingTemplate, SignatureApprovedLabel: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="ผู้อนุมัติ หรือ ผู้จัดการเขต"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ลายมือชื่อ 3 (คลัง/การเงิน)</label>
                      <input
                        type="text"
                        value={editingTemplate.SignatureWarehouseLabel || ''}
                        onChange={e => setEditingTemplate({ ...editingTemplate, SignatureWarehouseLabel: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="พนักงานคลังสินค้า หรือ ฝ่ายการเงิน"
                      />
                    </div>
                    <div className="flex items-center gap-4 pt-5">
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={editingTemplate.ShowSignatures !== false}
                          onChange={e => setEditingTemplate({ ...editingTemplate, ShowSignatures: e.target.checked })}
                          className="rounded text-[#0C447C]"
                        />
                        แสดงกล่องลายมือชื่อ
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={editingTemplate.ShowPageNumber !== false}
                          onChange={e => setEditingTemplate({ ...editingTemplate, ShowPageNumber: e.target.checked })}
                          className="rounded text-[#0C447C]"
                        />
                        แสดงเลขหน้า
                      </label>
                    </div>
                  </div>

                  {/* Mandatory Reason Box */}
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-1">
                    <label className="block font-bold text-amber-900 text-xs flex items-center gap-1.5">
                      <ShieldCheck size={14} className="text-amber-700" /> เหตุผลในการแก้ไข/สร้างแม่แบบ (Audit Log Reason) *
                    </label>
                    <input
                      type="text"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลงตามมาตรฐาน SO-10"
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-amber-500"
                      required
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <button
                      type="button"
                      onClick={() => { setEditingTemplate(null); setIsNewTemplate(false); }}
                      className="px-4 py-2 border rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-5 py-2 rounded-lg text-xs font-semibold bg-[#0C447C] text-white hover:bg-[#184E88] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Save size={14} /> {submitting ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-gray-800 text-sm">รายการแม่แบบรายงาน (Report Templates)</h3>
                      <p className="text-xs text-gray-500">แม่แบบกำหนดการจัดวางหน้า ทิศทางกระดาษ และบล็อกลายเซ็นอนุมัติ</p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingTemplate({
                          TemplateCode: '',
                          TemplateName: '',
                          HeaderId: headers[0]?.HeaderId || 1,
                          Orientation: 'portrait',
                          PaperSize: 'A4',
                          ShowPageNumber: true,
                          ShowSignatures: true,
                          SignatureSalesLabel: 'พนักงานขาย',
                          SignatureApprovedLabel: 'ผู้อนุมัติ',
                          SignatureWarehouseLabel: 'พนักงานคลังสินค้า',
                          Version: 1,
                          IsActive: true
                        });
                        setIsNewTemplate(true);
                        setReason('');
                      }}
                      className="px-3.5 py-2 bg-[#0C447C] hover:bg-[#184E88] text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Plus size={14} /> เพิ่มแม่แบบใหม่
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {templates.map(t => (
                      <div key={t.TemplateId} className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs hover:border-blue-300 transition-colors">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-mono text-xs font-bold text-[#0C447C]">{t.TemplateCode}</span>
                            <h4 className="font-bold text-gray-900 text-sm mt-0.5">{t.TemplateName}</h4>
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                            v{t.Version}
                          </span>
                        </div>

                        <div className="mt-3 text-xs text-gray-600 space-y-1 bg-gray-50/70 p-2.5 rounded-lg border border-gray-100">
                          <div><span className="text-gray-400">หัวกระดาษ:</span> <b>{t.HeaderName || t.HeaderCode}</b></div>
                          <div><span className="text-gray-400">ขนาด / ทิศทาง:</span> <b>{t.PaperSize} · {t.Orientation === 'landscape' ? 'แนวนอน' : 'แนวตั้ง'}</b></div>
                          <div className="truncate"><span className="text-gray-400">ลายเซ็น:</span> <b>{t.SignatureSalesLabel || '-'} / {t.SignatureApprovedLabel || '-'} / {t.SignatureWarehouseLabel || '-'}</b></div>
                        </div>

                        <div className="mt-3 pt-2 border-t flex justify-end">
                          <button
                            onClick={() => {
                              setEditingTemplate(t);
                              setIsNewTemplate(false);
                              setReason('');
                            }}
                            className="px-3 py-1.5 text-xs font-medium text-[#0C447C] hover:bg-blue-50 rounded-md inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit2 size={13} /> แก้ไขแม่แบบ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 3: REPORT ASSIGNMENTS                                     */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'assignments' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-gray-800 text-sm">การกำหนดแม่แบบให้แก่รายงานแต่ละฉบับ</h3>
                <p className="text-xs text-gray-500">เลือกแม่แบบและหัวกระดาษที่ต้องการให้รายงานแต่ละตัวใช้งานเมื่อพิมพ์หรือ Export</p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100/80 text-gray-700 border-b font-semibold">
                      <th className="py-2.5 px-3">รหัสรายงาน (Report Key)</th>
                      <th className="py-2.5 px-3">แม่แบบที่ผูกปัจจุบัน</th>
                      <th className="py-2.5 px-3">หัวกระดาษบริษัท</th>
                      <th className="py-2.5 px-3">ทิศทาง</th>
                      <th className="py-2.5 px-3 text-right">เปลี่ยนแม่แบบ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {assignments.map(a => (
                      <tr key={a.AssignmentId} className="hover:bg-blue-50/30 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-gray-800">
                          {a.ReportKey}
                          {a.ReportKey === 'default' && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-gray-200 text-gray-700">ค่าเริ่มต้น</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-[#0C447C]">{a.TemplateName || a.TemplateCode}</span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">{a.HeaderName || a.HeaderCode}</td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {a.Orientation === 'landscape' ? 'แนวนอน (Landscape)' : 'แนวตั้ง (Portrait)'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <select
                            value={a.TemplateId}
                            onChange={e => handleUpdateAssignment(a.ReportKey, Number(e.target.value))}
                            className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white hover:border-[#0C447C] cursor-pointer"
                          >
                            {templates.map(t => (
                              <option key={t.TemplateId} value={t.TemplateId}>
                                {t.TemplateName} ({t.Orientation})
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 4: AUDIT HISTORY                                          */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-gray-800 text-sm">ประวัติการบันทึกการเปลี่ยนแปลง (Audit Log จาก wf.ChangeEvent)</h3>
                <p className="text-xs text-gray-500">บันทึกทุกการสร้าง แก้ไข และกำหนดแม่แบบพร้อมเหตุผลและตัวตนผู้กระทำ</p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100/80 text-gray-700 border-b font-semibold">
                      <th className="py-2 px-3">เวลา (UTC)</th>
                      <th className="py-2 px-3">Entity</th>
                      <th className="py-2 px-3">ID / Code</th>
                      <th className="py-2 px-3">การกระทำ</th>
                      <th className="py-2 px-3">ผู้ดำเนินการ</th>
                      <th className="py-2 px-3">เหตุผลที่ระบุ (Reason)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {audits.map(au => (
                      <tr key={au.EventId} className="hover:bg-gray-50 text-[11px]">
                        <td className="py-2 px-3 font-mono text-gray-500">{au.CreatedAt?.slice(0, 19).replace('T', ' ')}</td>
                        <td className="py-2 px-3 font-semibold text-gray-700">{au.EntityType}</td>
                        <td className="py-2 px-3 font-mono text-gray-800">{au.EntityId}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            au.Action === 'CREATE' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {au.Action}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-medium text-gray-700">{au.UserId}</td>
                        <td className="py-2 px-3 text-gray-800 font-medium">{au.ReasonText || '-'}</td>
                      </tr>
                    ))}
                    {audits.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-gray-400">ยังไม่มีประวัติการเปลี่ยนแปลง</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t bg-gray-100/80 flex items-center justify-between text-xs text-gray-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-700" />
            <span>ระบบตรวจสอบการเปลี่ยนแปลงและบันทึกอัตโนมัติ (Durable Audit Trail)</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg cursor-pointer transition-colors"
          >
            ปิดหน้าต่าง
          </button>
        </div>

      </div>
    </div>
  );
}
