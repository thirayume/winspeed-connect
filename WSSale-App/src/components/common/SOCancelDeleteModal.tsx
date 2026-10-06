import { useState, useEffect } from 'react';
import { AlertTriangle, X, Check, Loader2 } from 'lucide-react';
import { fetchEditReasons, type EditReason } from '../../services/api';

export interface SOCancelDeleteModalProps {
  isOpen: boolean;
  mode: 'CANCEL' | 'DELETE';
  targetTitle: string;
  itemCount?: number;
  onClose: () => void;
  onConfirm: (reasonCode: string, reasonText: string) => Promise<void>;
}

export function SOCancelDeleteModal({
  isOpen,
  mode,
  targetTitle,
  itemCount = 1,
  onClose,
  onConfirm,
}: SOCancelDeleteModalProps) {
  const [reasons, setReasons] = useState<EditReason[]>([]);
  const [selectedReasonCode, setSelectedReasonCode] = useState<string>('');
  const [customReasonText, setCustomReasonText] = useState<string>('');
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const stage = mode === 'CANCEL' ? 'SO_CANCEL' : 'SO_DELETE';


  useEffect(() => {
    if (isOpen) {
      setSelectedReasonCode('');
      setCustomReasonText('');
      setErrorMessage('');
      setLoadingReasons(true);

      fetchEditReasons(stage)
        .then((res) => {
          const list = res.data || [];
          setReasons(list);
          // If only 1 reason and not OTHER, we can leave unselected to force explicit choice
        })
        .catch((err) => {
          console.error('[SOCancelDeleteModal] failed to fetch reasons:', err);
          setErrorMessage('ไม่สามารถโหลดรายการเหตุผลได้ กรุณาลองใหม่อีกครั้ง');
        })
        .finally(() => {
          setLoadingReasons(false);
        });
    }
  }, [isOpen, stage]);

  if (!isOpen) return null;

  const isOther = selectedReasonCode === 'OTHER';
  const isReasonChosen = selectedReasonCode.trim().length > 0;
  const isCustomTextValid = isOther ? customReasonText.trim().length >= 5 : true;
  const canSubmit = isReasonChosen && isCustomTextValid && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage('');

    try {
      const selectedObj = reasons.find((r) => r.reasonCode === selectedReasonCode);
      const defaultText = selectedObj?.reasonText || selectedReasonCode;
      const finalReasonText = isOther ? customReasonText.trim() : defaultText;

      await onConfirm(selectedReasonCode, finalReasonText);
      onClose();
    } catch (err: any) {
      console.error('[SOCancelDeleteModal] confirm failed:', err);
      setErrorMessage(err?.message || 'เกิดข้อผิดพลาดในการดำเนินการ');
    } finally {
      setSubmitting(false);
    }
  };

  const actionName = mode === 'CANCEL' ? 'ยกเลิก' : 'ลบทิ้ง';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-gray-100 flex flex-col">
        {/* Header */}
        <div className={`p-4 sm:p-5 flex items-start justify-between border-b ${mode === 'CANCEL' ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${mode === 'CANCEL' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
              <AlertTriangle size={22} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base sm:text-lg">
                ยืนยันการ{actionName} {targetTitle}
              </h3>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                {itemCount > 1
                  ? `การดำเนินการนี้จะ${actionName}เอกสารทั้งหมด ${itemCount} บิลในกลุ่มนี้`
                  : 'กรุณาระบุเหตุผลเพื่อบันทึกประวัติการตรวจสอบ (Audit Trail)'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-sm max-h-[75vh] overflow-y-auto">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0 text-red-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              เหตุผลในการ{actionName} <span className="text-red-500">*</span>
            </label>

            {loadingReasons ? (
              <div className="py-8 flex flex-col items-center justify-center text-gray-400 gap-2">
                <Loader2 size={24} className="animate-spin text-[#0C447C]" />
                <span className="text-xs">กำลังโหลดรายการเหตุผลจากระบบ...</span>
              </div>
            ) : reasons.length === 0 ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-gray-500 text-xs">
                ไม่พบเหตุผลที่เปิดใช้งานในระบบ กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งาน Reason Master
              </div>
            ) : (
              <div className="space-y-2">
                {reasons.map((r) => {
                  const isSelected = selectedReasonCode === r.reasonCode;
                  return (
                    <label
                      key={r.reasonCode}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? mode === 'CANCEL'
                            ? 'border-amber-400 bg-amber-50/70 shadow-sm'
                            : 'border-red-400 bg-red-50/70 shadow-sm'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="so_action_reason"
                        value={r.reasonCode}
                        checked={isSelected}
                        onChange={() => setSelectedReasonCode(r.reasonCode)}
                        className="mt-0.5 w-4 h-4 text-[#0C447C] focus:ring-0 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 text-xs sm:text-sm">
                          {r.reasonText || r.reasonCode}
                        </div>
                        {r.reasonCode === 'OTHER' && (
                          <span className="text-[11px] text-gray-400 block mt-0.5">
                            (ต้องระบุรายละเอียดเพิ่มเติมอย่างน้อย 5 ตัวอักษร)
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* If OTHER is chosen, show textarea */}
          {isOther && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <label className="block text-xs font-bold text-gray-700">
                รายละเอียดเหตุผลเพิ่มเติม <span className="text-red-500">*</span>
              </label>
              <textarea
                value={customReasonText}
                onChange={(e) => setCustomReasonText(e.target.value)}
                placeholder="กรุณาระบุรายละเอียดเหตุผลอย่างน้อย 5 ตัวอักษร..."
                rows={3}
                className={`w-full p-3 rounded-xl border text-sm focus:outline-none transition-colors ${
                  customReasonText.trim().length > 0 && customReasonText.trim().length < 5
                    ? 'border-red-300 focus:border-red-500 bg-red-50/30'
                    : 'border-gray-200 focus:border-[#0C447C]'
                }`}
              />
              <div className="flex justify-between items-center text-[11px] text-gray-400 px-1">
                <span>บังคับกรอกอย่างน้อย 5 ตัวอักษร</span>
                <span className={customReasonText.trim().length < 5 ? 'text-red-500 font-bold' : 'text-emerald-600'}>
                  {customReasonText.trim().length}/5 ตัวอักษร
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-gray-600 hover:bg-gray-200/60 transition-colors disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className={`px-5 py-2 rounded-xl text-xs sm:text-sm font-bold text-white shadow-sm flex items-center gap-1.5 transition-all ${
              canSubmit
                ? mode === 'CANCEL'
                  ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                  : 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
                : 'bg-gray-300 cursor-not-allowed opacity-60'
            }`}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                กำลังดำเนินการ...
              </>
            ) : (
              <>
                <Check size={16} />
                ยืนยันการ{actionName}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
