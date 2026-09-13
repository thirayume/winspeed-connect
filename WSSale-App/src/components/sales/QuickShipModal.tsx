import { useState } from 'react';
import { X, Scale, AlertTriangle, Truck } from 'lucide-react';
import { shipSO } from '../../services/api';
import { Modal } from '../ui/Modal';

interface QuickShipModalProps {
  isOpen: boolean;
  onClose: () => void;
  soIds: (string | number)[];
  onSuccess?: () => void;
}

export function QuickShipModal({ isOpen, onClose, soIds, onSuccess }: QuickShipModalProps) {
  const [gross, setGross] = useState<string>('');
  const [tare, setTare] = useState<string>('');
  const [scaleNo, setScaleNo] = useState<string>('1');
  const [isOverride, setIsOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [evidencePhotoUrl, setEvidencePhotoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const grossNum = Number(gross);
    const tareNum = Number(tare);

    if (!gross || !tare || isNaN(grossNum) || isNaN(tareNum)) {
      return setError('กรุณาระบุน้ำหนักให้ถูกต้องและครบถ้วน');
    }
    if (grossNum <= 0 || tareNum < 0) {
      return setError('ค่าน้ำหนักต้องเป็นค่าบวก');
    }
    if (grossNum <= tareNum) {
      return setError('น้ำหนักชั่งออกต้องมากกว่าน้ำหนักรถเปล่า');
    }

    if (isOverride) {
      if (!overrideReason || overrideReason.trim().length < 10) {
        return setError('กรุณาระบุเหตุผลการยกเว้นโดยผู้จัดการอย่างน้อย 10 ตัวอักษร');
      }
      if (!evidencePhotoUrl || evidencePhotoUrl.trim() === '') {
        return setError('กรุณาแนบ URL รูปถ่ายหลักฐานการชั่งน้ำหนัก');
      }
    }

    setBusy(true);
    try {
      await Promise.all(
        soIds.map(id =>
          shipSO(Number(id), grossNum, {
            tareKg: tareNum,
            scaleNo: Number(scaleNo) || 1,
            isManualOverride: isOverride,
            overrideReason: isOverride ? overrideReason.trim() : undefined,
            evidencePhotoUrl: isOverride ? evidencePhotoUrl.trim() : undefined,
          })
        )
      );
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err.message || 'เกิดข้อผิดพลาดในการบันทึกน้ำหนัก';
      setError(msg);
      if (msg.includes('Scale Event') || msg.includes('ไม่พบประวัติการชั่งจริง') || msg.includes('Exception Workflow')) {
        setIsOverride(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} title="ส่งออกจากตาชั่ง (ชั่งออก)">
      <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
        <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm flex gap-2 items-start">
          <Truck className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <strong>กำลังส่งออก {soIds.length} รายการ</strong>
            <p className="opacity-90 mt-1 text-xs">ระบบบังคับให้บันทึกน้ำหนักจริงจากเครื่องชั่ง หรือผ่านข้อยกเว้นโดยผู้จัดการ</p>
          </div>
        </div>

        {error && (
          <div data-testid="ship-error-alert" className="bg-red-50 text-red-700 p-3 rounded-lg text-sm flex gap-2 items-start">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <span>{error}</span>
              {error.includes('Exception Workflow') && !isOverride && (
                <button
                  type="button"
                  onClick={() => setIsOverride(true)}
                  className="block mt-1 text-xs font-bold underline text-red-800 hover:text-red-900"
                >
                  คลิกที่นี่เพื่อดำเนินการผ่าน Exception Workflow (ผู้จัดการ)
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">น้ำหนักชั่งออก (กก.) *</label>
            <input
              data-testid="input-ship-gross"
              type="number"
              step="1"
              min="1"
              value={gross}
              onChange={e => setGross(e.target.value)}
              disabled={busy}
              required
              placeholder="e.g. 45000"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0C447C]/50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">น้ำหนักรถเปล่า (กก.) *</label>
            <input
              data-testid="input-ship-tare"
              type="number"
              step="1"
              min="0"
              value={tare}
              onChange={e => setTare(e.target.value)}
              disabled={busy}
              required
              placeholder="e.g. 15000"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0C447C]/50"
            />
          </div>
        </div>
        
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">หมายเลขเครื่องชั่ง</label>
          <select
            data-testid="select-ship-scale"
            value={scaleNo}
            onChange={e => setScaleNo(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0C447C]/50"
          >
            <option value="1">เครื่องชั่ง 1 (T1)</option>
            <option value="2">เครื่องชั่ง 2 (T2)</option>
            <option value="3">เครื่องชั่ง 3 (T3)</option>
          </select>
        </div>

        {/* Managerial Exception Workflow Section */}
        <div className="pt-2 border-t space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              data-testid="checkbox-manual-override"
              type="checkbox"
              checked={isOverride}
              onChange={e => setIsOverride(e.target.checked)}
              disabled={busy}
              className="rounded text-[#0C447C] focus:ring-[#0C447C]"
            />
            <span className="text-xs font-bold text-amber-800">ขอยกเว้นการชั่งจริงโดยผู้จัดการ (Managerial Exception Override)</span>
          </label>

          {isOverride && (
            <div data-testid="override-fields" className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-amber-900 mb-1">เหตุผลการยกเว้น (อย่างน้อย 10 ตัวอักษร) *</label>
                <textarea
                  data-testid="input-override-reason"
                  value={overrideReason}
                  onChange={e => setOverrideReason(e.target.value)}
                  disabled={busy}
                  rows={2}
                  placeholder="เช่น เครื่องชั่งโรง 1 อยู่ระหว่างตรวจเช็คประจำปี ใช้แท่นชั่งสะพานกลาง"
                  className="w-full p-2 bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
                <span className="text-[10px] text-amber-700">ระบุแล้ว {overrideReason.length}/10 ตัวอักษร</span>
              </div>

              <div>
                <label className="block font-semibold text-amber-900 mb-1">URL รูปถ่ายหลักฐานชั่งน้ำหนัก (Photo Evidence) *</label>
                <input
                  data-testid="input-override-photo"
                  type="url"
                  value={evidencePhotoUrl}
                  onChange={e => setEvidencePhotoUrl(e.target.value)}
                  disabled={busy}
                  placeholder="https://img.thirayu.online/scale_ticket_photo.jpg"
                  className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>
            </div>
          )}
        </div>

        <div className="pt-2 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            ยกเลิก
          </button>
          <button
            data-testid="btn-confirm-ship"
            type="submit"
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#0C447C] rounded-lg flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
          >
            <Scale className="w-4 h-4" />
            {busy ? 'กำลังบันทึก...' : 'บันทึกน้ำหนัก & ส่งออก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
