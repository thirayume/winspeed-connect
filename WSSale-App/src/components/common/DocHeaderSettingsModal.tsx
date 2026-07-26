import React, { useState, useEffect } from 'react';
import { Settings, X, Save, RotateCcw, Building2, MapPin, Phone, FileText, QrCode, Upload, Image, ShieldAlert, CheckCircle2, Layers, Globe } from 'lucide-react';
import {
  getDocHeaderConfig,
  saveDocHeaderConfig,
  resetReportDocHeaderConfig,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_WF_LOGO_DATA_URL,
  type DocHeaderConfig
} from '../../utils/docHeaderSettings';
import { useAuthStore } from '../../store/auth-store';
import { canManageDocHeaderSettings } from '../../utils/permissions';

export function DocHeaderSettingsModal({
  isOpen,
  onClose,
  reportId,
  reportTitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  reportId?: string;
  reportTitle?: string;
}) {
  const currentUser = useAuthStore(s => s.user);
  const [config, setConfig] = useState<DocHeaderConfig>(() => getDocHeaderConfig(reportId));
  const [scope, setScope] = useState<'REPORT' | 'GLOBAL' | 'SET_DEFAULT'>(reportId ? 'REPORT' : 'GLOBAL');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(getDocHeaderConfig(reportId));
      setScope(reportId ? 'REPORT' : 'GLOBAL');
    }
  }, [isOpen, reportId]);

  if (!isOpen) return null;

  const hasAccess = canManageDocHeaderSettings(currentUser);
  const isAdminOrCLevel = currentUser?.role === 'ADMIN' || currentUser?.role === 'C_LEVEL';

  const handleChange = (field: keyof DocHeaderConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert('ขนาดไฟล์โลโก้ต้องไม่เกิน 3MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        handleChange('logoUrl', evt.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUseDefaultLogo = () => {
    handleChange('logoUrl', DEFAULT_WF_LOGO_DATA_URL);
  };

  const handleSave = () => {
    saveDocHeaderConfig(config, scope, reportId);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const handleReset = () => {
    if (confirm(reportId && scope === 'REPORT' ? `คุณต้องการรีเซ็ตการตั้งค่าของ "${reportTitle || reportId}" กลับไปใช้ค่าส่วนกลางหรือไม่?` : 'คุณต้องการรีเซ็ตตั้งค่าหัวกระดาษและท้ายกระดาษเป็นค่าเริ่มต้นของระบบหรือไม่?')) {
      if (reportId && scope === 'REPORT') {
        const globalCfg = resetReportDocHeaderConfig(reportId);
        setConfig(globalCfg);
      } else {
        setConfig(DEFAULT_HEADER_CONFIG);
        saveDocHeaderConfig(DEFAULT_HEADER_CONFIG, 'SET_DEFAULT');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 print:hidden" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#0C447C] to-[#1F3864] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <Settings size={20} className="text-blue-200" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">ตั้งค่าหัวกระดาษ & ท้ายกระดาษ (Header & Footer Settings)</h3>
              <p className="text-xs text-blue-200">
                {reportTitle ? `สำหรับรายงาน: ${reportTitle}` : 'ปรับแต่งชื่อบริษัท, โลโก้, ที่อยู่ และส่วนการลงนามอนุมัติ'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        {!hasAccess ? (
          <div className="p-10 flex flex-col items-center justify-center text-center space-y-3">
            <div className="h-14 w-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center">
              <ShieldAlert size={32} />
            </div>
            <h4 className="font-bold text-gray-800 text-base">ไม่มีสิทธิ์ในการตั้งค่าหัวกระดาษ</h4>
            <p className="text-xs text-gray-500 max-w-md">
              สิทธิ์การตั้งค่าหัวกระดาษและเทมเพลตเอกสารจำกัดเฉพาะผู้ใช้ระดับ <b>Admin</b>, <b>C-Level</b>, <b>Manager</b> และ <b>Accounting</b> เท่านั้น
            </p>
            <button onClick={onClose} className="mt-2 px-5 py-2 bg-gray-200 hover:bg-gray-300 rounded-xl text-xs font-bold text-gray-700">
              ปิดหน้าต่าง
            </button>
          </div>
        ) : (
          <div className="p-6 overflow-y-auto space-y-5 text-sm flex-1">

            {/* Scope Selection Box (Apply to All vs Per-Report vs Set Default) */}
            <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
              <label className="block font-bold text-blue-900 text-xs flex items-center gap-1.5">
                <Globe size={14} className="text-[#0C447C]" /> ขอบเขตการบันทึกการตั้งค่า (Apply Scope):
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {reportId && (
                  <button
                    type="button"
                    onClick={() => setScope('REPORT')}
                    className={`p-2.5 rounded-lg border text-left text-xs font-semibold flex items-center gap-2 transition-all ${
                      scope === 'REPORT' ? 'bg-[#0C447C] text-white border-[#0C447C] shadow-sm' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <Layers size={14} /> เฉพาะรายงานนี้ ({reportTitle || reportId})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setScope('GLOBAL')}
                  className={`p-2.5 rounded-lg border text-left text-xs font-semibold flex items-center gap-2 transition-all ${
                    scope === 'GLOBAL' ? 'bg-[#0C447C] text-white border-[#0C447C] shadow-sm' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Globe size={14} /> ใช้กับทุกรายงาน (Apply to All)
                </button>
                <button
                  type="button"
                  onClick={() => setScope('SET_DEFAULT')}
                  className={`p-2.5 rounded-lg border text-left text-xs font-semibold flex items-center gap-2 transition-all ${
                    scope === 'SET_DEFAULT' ? 'bg-[#0C447C] text-white border-[#0C447C] shadow-sm' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <CheckCircle2 size={14} /> ตั้งเป็นค่าเริ่มต้น (Set as Default)
                </button>
              </div>
            </div>

            {/* Company Name TH/EN */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-gray-700 mb-1 flex items-center gap-1.5 text-xs">
                  <Building2 size={14} className="text-[#0C447C]" /> ชื่อบริษัท (ภาษาไทย)
                </label>
                <input
                  type="text"
                  value={config.companyNameTh}
                  onChange={e => handleChange('companyNameTh', e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#0C447C] focus:border-transparent font-medium"
                />
              </div>
              <div>
                <label className="block font-semibold text-gray-700 mb-1 flex items-center gap-1.5 text-xs">
                  <Building2 size={14} className="text-[#0C447C]" /> ชื่อบริษัท (ภาษาอังกฤษ)
                </label>
                <input
                  type="text"
                  value={config.companyNameEn}
                  onChange={e => handleChange('companyNameEn', e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#0C447C] focus:border-transparent font-medium"
                />
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="block font-semibold text-gray-700 mb-1 flex items-center gap-1.5 text-xs">
                <MapPin size={14} className="text-[#0C447C]" /> ที่อยู่บริษัท (สำหรับแสดงบนหัวกระดาษ)
              </label>
              <textarea
                rows={2}
                value={config.addressTh}
                onChange={e => handleChange('addressTh', e.target.value)}
                className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#0C447C] focus:border-transparent font-medium leading-relaxed"
              />
            </div>

            {/* Tel / Fax / Tax ID */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-gray-700 mb-1 flex items-center gap-1.5 text-xs">
                  <Phone size={14} className="text-[#0C447C]" /> เบอร์โทรศัพท์
                </label>
                <input
                  type="text"
                  value={config.tel}
                  onChange={e => handleChange('tel', e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#0C447C]"
                />
              </div>
              <div>
                <label className="block font-semibold text-gray-700 mb-1 flex items-center gap-1.5 text-xs">
                  <Phone size={14} className="text-[#0C447C]" /> เบอร์โทรสาร (Fax)
                </label>
                <input
                  type="text"
                  value={config.fax}
                  onChange={e => handleChange('fax', e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#0C447C]"
                />
              </div>
              <div>
                <label className="block font-semibold text-gray-700 mb-1 flex items-center gap-1.5 text-xs">
                  <FileText size={14} className="text-[#0C447C]" /> เลขผู้เสียภาษี (Tax ID)
                </label>
                <input
                  type="text"
                  value={config.taxId}
                  onChange={e => handleChange('taxId', e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#0C447C]"
                />
              </div>
            </div>

            {/* Logo Settings */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-gray-800 flex items-center gap-1.5 text-xs">
                  <Image size={15} className="text-[#0C447C]" /> ตราสัญลักษณ์ / โลโก้บริษัท (Logo)
                </label>
                <button
                  type="button"
                  onClick={handleUseDefaultLogo}
                  className="text-[11px] font-bold text-[#0C447C] hover:underline flex items-center gap-1"
                >
                  ใช้โลโก้มาตรฐาน WF
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                {/* Logo Preview */}
                <div className="h-14 w-32 bg-white border border-gray-300 rounded-lg flex items-center justify-center p-1.5 shrink-0 shadow-sm">
                  {config.logoUrl ? (
                    <img src={config.logoUrl} alt="Logo Preview" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-gray-400 font-bold">ตราสัญลักษณ์ W</span>
                  )}
                </div>

                <div className="flex-1 space-y-2 w-full">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="วาง URL รูปภาพโลโก้..."
                      value={config.logoUrl}
                      onChange={e => handleChange('logoUrl', e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#0C447C]"
                    />
                    <label className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-xs font-semibold text-gray-700 cursor-pointer flex items-center gap-1 shrink-0 transition-colors">
                      <Upload size={13} /> อัปโหลดไฟล์
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoFileUpload} />
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    * รองรับการแนบ URL หรืออัปโหลดไฟล์รูปภาพจากเครื่อง (PNG, JPG, SVG)
                  </p>
                </div>
              </div>
            </div>

            {/* QR Verification Base URL (Admin/C-Level only) */}
            {isAdminOrCLevel && (
              <div>
                <label className="block font-semibold text-gray-700 mb-1 flex items-center gap-1.5 text-xs">
                  <QrCode size={14} className="text-[#0C447C]" /> QR Code Verification Base URL (เฉพาะ Admin)
                </label>
                <input
                  type="text"
                  value={config.verificationBaseUrl}
                  onChange={e => handleChange('verificationBaseUrl', e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#0C447C]"
                />
              </div>
            )}

            {/* Signatures & Footers Options */}
            <div className="border-t border-gray-200 pt-4 space-y-4">
              <h4 className="font-bold text-gray-800 text-xs">การตั้งค่าส่วนท้ายกระดาษ (Footer Settings)</h4>

              {/* Toggles */}
              <div className="flex items-center gap-6 text-xs font-semibold text-gray-700">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.showSignatures ?? true}
                    onChange={e => handleChange('showSignatures', e.target.checked)}
                    className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                  />
                  แสดงช่องลงนามอนุมัติ (Signatures)
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.showFooterNote ?? true}
                    onChange={e => handleChange('showFooterNote', e.target.checked)}
                    className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                  />
                  แสดงข้อความกำกับท้ายกระดาษ
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.showPageNumber ?? true}
                    onChange={e => handleChange('showPageNumber', e.target.checked)}
                    className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
                  />
                  แสดงเลขหน้า (Page X / Y)
                </label>
              </div>

              {/* Footer Note Text */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ข้อความกำกับท้ายกระดาษ (Footer Note Line)
                </label>
                <input
                  type="text"
                  value={config.footerNote || ''}
                  onChange={e => handleChange('footerNote', e.target.value)}
                  placeholder="เช่น เอกสารนี้ออกโดยระบบอัตโนมัติ WINSpeed-Connect · บริษัท เวิลด์ เฟอท จำกัด"
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-xs"
                />
              </div>

              {/* Signature Positions Labels */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  ข้อความชื่อตำแหน่งผู้ลงนาม (Signature Box Titles)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">ตำแหน่งที่ 1 (พนักงานขาย)</label>
                    <input
                      type="text"
                      value={config.signatureSalesLabel}
                      onChange={e => handleChange('signatureSalesLabel', e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">ตำแหน่งที่ 2 (ผู้อนุมัติ)</label>
                    <input
                      type="text"
                      value={config.signatureApprovedLabel}
                      onChange={e => handleChange('signatureApprovedLabel', e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">ตำแหน่งที่ 3 (พนักงานคลังสินค้า)</label>
                    <input
                      type="text"
                      value={config.signatureWarehouseLabel}
                      onChange={e => handleChange('signatureWarehouseLabel', e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Modal Footer */}
        {hasAccess && (
          <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
            <button
              onClick={handleReset}
              className="px-3.5 py-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg font-medium text-xs flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw size={14} /> {reportId && scope === 'REPORT' ? 'รีเซ็ตรายงานนี้' : 'รีเซ็ตเป็นค่าเริ่มต้นระบบ'}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg text-xs"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-2 bg-[#0C447C] hover:bg-[#1F3864] text-white font-medium rounded-lg text-xs flex items-center gap-1.5 shadow transition-all font-bold"
              >
                <Save size={15} /> {savedSuccess ? 'บันทึกเรียบร้อย!' : scope === 'REPORT' ? 'บันทึกสำหรับรายงานนี้' : scope === 'SET_DEFAULT' ? 'บันทึกเป็นค่าเริ่มต้นระบบ' : 'บันทึกใช้กับทุกรายงาน (Apply to All)'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
