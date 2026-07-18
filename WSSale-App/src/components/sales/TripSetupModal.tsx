import { useState, useEffect } from 'react';
import { X, Search, Truck, MapPin } from 'lucide-react';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { fetchCustomers, fetchTruckPlates } from '../../services/api';
import type { EMCust } from '../../types';

export function TripSetupModal({
  isOpen,
  onClose,
  onConfirm,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: { custId: string; custName: string; truckPlate: string; deliveryDate: string; creditDays?: number; pSling?: boolean; loadInOrder?: boolean; }) => void;
  initialData?: { custId: string; custName: string; truckPlate: string; deliveryDate: string; creditDays?: number; pSling?: boolean; loadInOrder?: boolean; };
}) {
  const [customers, setCustomers] = useState<EMCust[]>([]);
  const [truckPlates, setTruckPlates] = useState<string[]>([]);

  const [custId, setCustId] = useState(initialData?.custId || '');
  const [custSearch, setCustSearch] = useState(initialData?.custName || '');
  const [debouncedSearch, setDebouncedSearch] = useState(initialData?.custName || '');
  const [isCustOpen, setIsCustOpen] = useState(false);

  const [truckPlate, setTruckPlate] = useState(initialData?.truckPlate || '');
  const [isTruckOpen, setIsTruckOpen] = useState(false);

  const [deliveryDate, setDeliveryDate] = useState(initialData?.deliveryDate || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));

  const [creditDays, setCreditDays] = useState(Number(initialData?.creditDays || 0));
  const [pSling, setPSling] = useState(initialData?.pSling || false);
  const [loadInOrder, setLoadInOrder] = useState(initialData?.loadInOrder || false);
  const [remark, setRemark] = useState(initialData?.remark || '');

  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setCustId(initialData?.custId || '');
      setCustSearch(initialData?.custName || '');
      setTruckPlate(initialData?.truckPlate || '');
      setDeliveryDate(initialData?.deliveryDate || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
      setCreditDays(Number(initialData?.creditDays || 0));
      setPSling(initialData?.pSling || false);
      setLoadInOrder(initialData?.loadInOrder || false);
      setRemark(initialData?.remark || '');
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(custSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [custSearch]);

  useEffect(() => {
    if (isOpen) {
      fetchCustomers(debouncedSearch.length >= 2 ? debouncedSearch : undefined).then(setCustomers).catch(console.error);
    }
  }, [debouncedSearch, isOpen]);

  useEffect(() => {
    if (custId) {
      fetchTruckPlates(custId).then(setTruckPlates).catch(console.error);
    } else {
      setTruckPlates([]);
    }
  }, [custId]);

  const handleConfirm = () => {
    if (!custId) {
      setError('กรุณาเลือกลูกค้าจากรายการ');
      return;
    }
    onConfirm({
      custId, custName: custSearch,
      truckPlate,
      deliveryDate,
      creditDays, pSling, loadInOrder, remark
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#0C447C] text-white">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <MapPin size={22} /> ข้อมูลการจัดส่ง (Trip)
          </h2>
          <button onClick={onClose} className="text-white/80 hover:text-white p-1 rounded-full hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm font-semibold border border-red-100">
              {error}
            </div>
          )}

          <div className="space-y-1 relative">
            <label className="text-sm font-bold text-gray-700">ลูกค้า *</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={custSearch}
                onChange={e => { setCustSearch(e.target.value); if (custId) setCustId(''); }}
                onFocus={() => setIsCustOpen(true)}
                onBlur={() => setTimeout(() => setIsCustOpen(false), 200)}
                placeholder="ค้นหาชื่อลูกค้า..."
                className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0C447C] focus:border-transparent transition-all"
              />
              {isCustOpen && (
                <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                  {customers.map(c => (
                    <div key={c.CustID} className="px-4 py-3 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0" onClick={() => { setCustId(c.CustID); setCustSearch(c.CustName); setCreditDays(c.CreditDays || 0); setIsCustOpen(false); }}>
                      <div className="font-bold text-gray-900">{c.CustName}</div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">{c.CustID}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1 relative">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
                <Truck size={14} /> ทะเบียนรถ
              </label>
            </div>
            <input
              value={truckPlate} onChange={e => setTruckPlate(e.target.value)}
              onFocus={() => setIsTruckOpen(true)}
              onBlur={() => setTimeout(() => setIsTruckOpen(false), 200)}
              placeholder="เช่น กจ70-4088"
              className={`w-full border rounded-xl px-4 py-2.5 font-mono focus:outline-none transition-all ${truckPlate && truckPlates.length > 0 && !truckPlates.includes(truckPlate) ? 'border-amber-400 focus:ring-2 focus:ring-amber-500 bg-amber-50' : 'border-gray-300 focus:ring-2 focus:ring-[#0C447C]'}`}
            />
            {truckPlate && truckPlates.length > 0 && !truckPlates.includes(truckPlate) && (
              <p className="text-xs text-amber-600 mt-1 font-semibold">⚠ เป็นทะเบียนใหม่ ระบบจะเพิ่มให้อัตโนมัติ</p>
            )}
            {isTruckOpen && truckPlates.length > 0 && (
              <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                {truckPlates.filter(p => p.toLowerCase().includes(truckPlate.toLowerCase())).map(p => (
                  <div key={p} className="px-4 py-2.5 text-sm hover:bg-gray-50 cursor-pointer font-mono border-b border-gray-50 last:border-0" onClick={() => { setTruckPlate(p); setIsTruckOpen(false); }}>
                    {p}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-700">เครดิต (วัน)</label>
              <input
                type="number" min="0"
                value={creditDays.toString()} onChange={e => setCreditDays(e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0C447C] transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-700">วันที่เอกสาร</label>
              <ThaiDatePicker value={deliveryDate} onChange={setDeliveryDate} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0C447C] transition-all" />
            </div>
          </div>

          <div className="flex gap-6 items-center pt-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer">
              <input type="checkbox" checked={pSling} onChange={e => setPSling(e.target.checked)} className="w-4 h-4 accent-[#0C447C]" />
              ใช้ Pre-Sling
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer">
              <input type="checkbox" checked={loadInOrder} onChange={e => setLoadInOrder(e.target.checked)} className="w-4 h-4 accent-[#0C447C]" />
              ขึ้นของตามลำดับ
            </label>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700">หมายเหตุทริป</label>
            <textarea
              value={remark} onChange={e => setRemark(e.target.value)}
              placeholder="ระบุหมายเหตุสำหรับทริปนี้ (ถ้ามี)..."
              rows={2}
              className="w-full border border-gray-300 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#0C447C] transition-all resize-none text-sm"
            />
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-200 rounded-xl transition-colors">
            ยกเลิก
          </button>
          <button onClick={handleConfirm} className="px-6 py-2.5 bg-[#0C447C] text-white font-bold rounded-xl hover:bg-blue-800 transition-colors shadow-md">
            ยืนยันและเริ่มจัดออร์เดอร์
          </button>
        </div>
      </div>
    </div>
  );
}
