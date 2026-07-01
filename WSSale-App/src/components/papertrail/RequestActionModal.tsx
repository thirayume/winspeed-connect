import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { fetchUnlockReasons } from '../../services/api';

export type RequestActionType = 'EDIT' | 'CANCEL';

interface RequestActionModalProps {
  isOpen: boolean;
  actionType: RequestActionType;
  wfRef: string;
  onClose: () => void;
  onSubmit: (reason: string, type: RequestActionType) => void;
}

const REASONS = [
  '🚚 เปลี่ยนรถ',
  '📦 สินค้าผิด/เปลี่ยนสินค้า',
  '📅 เลื่อนวันส่ง',
  '❌ ลูกค้ายกเลิก'
];

export function RequestActionModal({ isOpen, actionType, wfRef, onClose, onSubmit }: RequestActionModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState('');
  const [historicalReasons, setHistoricalReasons] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedReason('');
      setCustomReason('');
      fetchUnlockReasons(actionType).then(setHistoricalReasons).catch(console.error);
    }
  }, [isOpen, actionType]);

  if (!isOpen) return null;

  const isOther = selectedReason === '✍️ อื่นๆ';
  const canSubmit = isOther ? customReason.trim().length >= 5 : selectedReason.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const finalReason = isOther ? customReason.trim() : selectedReason;
    onSubmit(finalReason, actionType);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className={`px-4 py-3 border-b flex justify-between items-center text-white ${actionType === 'EDIT' ? 'bg-[#0C447C]' : 'bg-red-600'}`}>
          <h2 className="font-bold text-lg">
            {actionType === 'EDIT' ? 'ขอแก้ไขเอกสาร' : 'ขอยกเลิกเอกสาร'} {wfRef}
          </h2>
          <button onClick={onClose} className="hover:bg-black/20 p-1 rounded-full"><X size={20} /></button>
        </div>
        
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">กรุณาเลือกหรือระบุเหตุผลในการ{actionType === 'EDIT' ? 'ขอแก้ไข' : 'ขอยกเลิก'}เอกสารนี้</p>
          
          <div className="space-y-2">
            {REASONS.map(reason => (
              <label key={reason} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${selectedReason === reason ? (actionType === 'EDIT' ? 'border-[#0C447C] bg-blue-50' : 'border-red-600 bg-red-50') : 'border-gray-200 hover:bg-gray-50'}`}>
                <input 
                  type="radio" 
                  name="request_reason" 
                  checked={selectedReason === reason} 
                  onChange={() => { setSelectedReason(reason); setCustomReason(''); }}
                  className={`w-4 h-4 ${actionType === 'EDIT' ? 'text-[#0C447C]' : 'text-red-600'}`}
                />
                <span className="text-sm font-medium">{reason}</span>
              </label>
            ))}
            
            <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${selectedReason === '✍️ อื่นๆ' ? (actionType === 'EDIT' ? 'border-[#0C447C] bg-blue-50' : 'border-red-600 bg-red-50') : 'border-gray-200 hover:bg-gray-50'}`}>
              <input 
                type="radio" 
                name="request_reason" 
                checked={selectedReason === '✍️ อื่นๆ'} 
                onChange={() => setSelectedReason('✍️ อื่นๆ')}
                className={`w-4 h-4 ${actionType === 'EDIT' ? 'text-[#0C447C]' : 'text-red-600'}`}
              />
              <span className="text-sm font-medium">✍️ อื่นๆ (ระบุเหตุผลเอง)</span>
            </label>
          </div>
          
          {isOther && (
            <div className="mt-2">
              <input
                autoFocus
                type="text"
                list="historical-reasons"
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-50 focus:border-transparent transition-shadow"
                placeholder="ระบุเหตุผล..."
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                style={actionType === 'EDIT' ? { '--tw-ring-color': '#0C447C' } as React.CSSProperties : { '--tw-ring-color': '#DC2626' } as React.CSSProperties}
              />
              <datalist id="historical-reasons">
                {historicalReasons.map((r, i) => (
                  <option key={i} value={r} />
                ))}
              </datalist>
            </div>
          )}
        </div>
        
        <div className="px-4 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            ปิด
          </button>
          <button 
            disabled={!canSubmit}
            onClick={handleSubmit} 
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center gap-2 disabled:opacity-50 ${actionType === 'EDIT' ? 'bg-[#0C447C] hover:bg-[#0a3663]' : 'bg-red-600 hover:bg-red-700'}`}
          >
            <Save size={16} /> ยืนยันคำขอ
          </button>
        </div>
      </div>
    </div>
  );
}
