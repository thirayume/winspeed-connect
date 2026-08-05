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

    setBusy(true);
    try {
      await Promise.all(
        soIds.map(id =>
          shipSO(Number(id), grossNum, {
            tareKg: tareNum,
            scaleNo: Number(scaleNo) || 1,
          })
        )
      );
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการบันทึกน้ำหนัก');
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
            <p className="opacity-90 mt-1 text-xs">ระบบบังคับให้บันทึกน้ำหนักจริงเพื่อเป็นหลักฐาน</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm flex gap-2 items-center">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">น้ำหนักชั่งออก (กก.) *</label>
            <input
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
