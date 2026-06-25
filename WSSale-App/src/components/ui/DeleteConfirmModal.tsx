import { useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

type DeleteConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  itemName: string;
  loading?: boolean;
};

export const DeleteConfirmModal = ({ isOpen, onClose, onConfirm, title, itemName, loading }: DeleteConfirmModalProps) => {
  const [confirmText, setConfirmText] = useState('');

  if (!isOpen) return null;

  const isConfirmed = confirmText === 'DELETE';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="bg-red-50 p-6 flex flex-col items-center text-center border-b border-red-100 relative">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-red-400 hover:text-red-600 hover:bg-red-100 p-1.5 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
          
          <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mb-4 border-4 border-white shadow-sm">
            <AlertTriangle size={32} className="text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-red-700 mb-2">{title}</h2>
          <p className="text-red-600/80 text-sm">
            การดำเนินการนี้ไม่สามารถย้อนกลับได้ และจะส่งผลกระทบต่อข้อมูลในระบบ Winspeed ERP
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700">
            คุณกำลังจะเปลี่ยนสถานะเป็น Inactive สำหรับ:
            <div className="font-bold text-gray-900 mt-1 break-words">{itemName}</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              กรุณาพิมพ์ <span className="font-mono font-bold text-red-600 bg-red-50 px-1 rounded">DELETE</span> เพื่อยืนยัน
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-center font-mono tracking-widest focus:outline-none focus:border-red-500 transition-colors"
              autoComplete="off"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={() => {
                if (isConfirmed) onConfirm();
              }}
              disabled={!isConfirmed || loading}
              className={`flex-1 px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${
                isConfirmed && !loading
                  ? 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-200'
                  : 'bg-red-100 text-red-400 cursor-not-allowed'
              }`}
            >
              {loading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Trash2 size={18} />
                  ยืนยันการลบ
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
