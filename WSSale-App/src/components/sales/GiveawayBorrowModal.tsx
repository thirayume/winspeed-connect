import React, { useState, useEffect } from 'react';
import { X, Search, CheckCircle } from 'lucide-react';
import { apiFetch } from '../../services/api';

interface Lender {
  SalesUserId: number;
  EmpId: string;
  EmpCode: string;
  Region: string;
  RemainingQty: number;
  DisplayName: string;
}

interface GiveawayBorrowModalProps {
  isOpen: boolean;
  onClose: () => void;
  brand: string;
  itemName: string;
  requiredQty: number;
  region: string;
  periodYear: parseInt;
  onSuccess: () => void;
}

export function GiveawayBorrowModal({ isOpen, onClose, brand, itemName, requiredQty, region, periodYear, onSuccess }: GiveawayBorrowModalProps) {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedLender, setSelectedLender] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && brand && itemName) {
      setLoading(true);
      apiFetch(`/giveaway/available-lenders?brand=${encodeURIComponent(brand)}&itemName=${encodeURIComponent(itemName)}&year=${periodYear}`)
        .then(res => setLenders(res))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [isOpen, brand, itemName, periodYear]);

  if (!isOpen) return null;

  const filteredLenders = lenders.filter(l => l.DisplayName.toLowerCase().includes(search.toLowerCase()) || l.EmpCode.toLowerCase().includes(search.toLowerCase()));

  const handleSubmit = async () => {
    if (!selectedLender) return alert('กรุณาเลือกผู้ให้ยืม');
    if (!reason.trim()) return alert('กรุณาระบุเหตุผลในการขอยืม');

    setSubmitting(true);
    try {
      await apiFetch('/giveaway/borrow-requests', {
        method: 'POST',
        body: JSON.stringify({
          lenderId: selectedLender,
          region,
          periodYear,
          brand,
          itemName,
          qty: requiredQty,
          reason
        })
      });
      onSuccess();
    } catch (e: any) {
      alert(e.message || 'Failed to submit borrow request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-amber-50">
          <h2 className="font-bold text-amber-900">ขอยืมโควต้าของแถม</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        
        <div className="p-4 border-b border-gray-100">
          <div className="text-sm text-gray-600 mb-1">ของแถมที่ต้องการยืม:</div>
          <div className="font-bold text-[#0C447C]">{brand} - {itemName}</div>
          <div className="text-sm font-bold text-amber-600 mt-1">จำนวนที่ต้องการ: {requiredQty} ชิ้น</div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <label className="block text-sm font-bold text-gray-700 mb-1">เหตุผลในการขอยืม *</label>
            <input 
              type="text" 
              value={reason} 
              onChange={e => setReason(e.target.value)}
              placeholder="เช่น เพื่อจัดโปรโมชันให้ลูกค้ารายใหญ่..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
            />
          </div>

          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-bold text-gray-700">เลือกผู้ให้ยืมที่มีโควต้าเหลือ</label>
          </div>
          
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อพนักงาน..."
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-blue-300"
            />
          </div>

          {loading ? (
            <div className="text-center py-4 text-gray-500 text-sm">กำลังค้นหาผู้ให้ยืม...</div>
          ) : filteredLenders.length === 0 ? (
            <div className="text-center py-4 text-gray-500 text-sm">ไม่พบพนักงานที่มีโควต้าเหลือเพียงพอ</div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {filteredLenders.map(l => (
                <div 
                  key={l.SalesUserId}
                  onClick={() => setSelectedLender(l.SalesUserId)}
                  className={`border rounded-lg p-3 cursor-pointer flex items-center justify-between transition-colors ${selectedLender === l.SalesUserId ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}
                >
                  <div>
                    <div className="font-bold text-sm text-gray-800">{l.DisplayName}</div>
                    <div className="text-xs text-gray-500">{l.EmpCode} • {l.Region}</div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div className="text-sm font-bold text-amber-600">{l.RemainingQty} ชิ้น</div>
                    {selectedLender === l.SalesUserId && <CheckCircle size={16} className="text-amber-500" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">ยกเลิก</button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting || !selectedLender || !reason.trim()}
            className="flex-1 px-4 py-2 text-sm font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'กำลังส่งคำขอ...' : 'ส่งคำขอยืม'}
          </button>
        </div>
      </div>
    </div>
  );
}
