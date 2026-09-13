import { useState, useEffect } from 'react';
import { X, Truck, MapPin } from 'lucide-react';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { fetchTruckStats, createTrip } from '../../services/api';

export type TripSetupData = {
  tripId?: number;
  tripCode?: string;
  truckPlate?: string;
  deliveryDate: string;
  pSling?: boolean;
  loadInOrder?: boolean;
  remark?: string;
};

export function TripSetupModal({
  isOpen,
  onClose,
  onConfirm,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: TripSetupData) => void;
  initialData?: TripSetupData;
}) {
  const [truckPlates, setTruckPlates] = useState<string[]>([]);
  const [truckPlate, setTruckPlate] = useState(initialData?.truckPlate || '');
  const [isTruckOpen, setIsTruckOpen] = useState(false);

  const [deliveryDate, setDeliveryDate] = useState(initialData?.deliveryDate || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));

  const [pSling, setPSling] = useState(initialData?.pSling || false);
  const [loadInOrder, setLoadInOrder] = useState(initialData?.loadInOrder || false);
  const [remark, setRemark] = useState(initialData?.remark || '');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTruckPlate(initialData?.truckPlate || '');
      setDeliveryDate(initialData?.deliveryDate || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
      setPSling(initialData?.pSling || false);
      setLoadInOrder(initialData?.loadInOrder || false);
      setRemark(initialData?.remark || '');
      setError('');
      setSubmitting(false);

      fetchTruckStats().then(stats => {
        setTruckPlates(stats.map(s => s.truckPlate).filter(Boolean));
      }).catch(console.error);
    }
  }, [isOpen, initialData]);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const plate = (!truckPlate || truckPlate === 'ยังไม่ระบุรถ') ? null : truckPlate;
      const res = await createTrip({
        transRegistration: plate,
        deliveryDate,
        truckCapacityTon: 30,
      });

      onConfirm({
        tripId: res.tripId,
        tripCode: res.tripCode,
        truckPlate: truckPlate || 'ยังไม่ระบุรถ',
        deliveryDate,
        pSling,
        loadInOrder,
        remark
      });
    } catch (e: any) {
      setError(e.message || 'สร้างเที่ยวรถไม่สำเร็จ');
      setSubmitting(false);
    }
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
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
                <Truck size={14} /> ทะเบียนรถ (เว้นว่างได้ — ยังไม่ระบุรถ)
              </label>
            </div>
            <input
              value={truckPlate} onChange={e => setTruckPlate(e.target.value)}
              onFocus={() => setIsTruckOpen(true)}
              onBlur={() => setTimeout(() => setIsTruckOpen(false), 200)}
              placeholder="เช่น กจ70-4088 (เว้นว่างได้สำหรับ Draft Trip)"
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

          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700">วันที่เอกสารเที่ยวรถ</label>
            <ThaiDatePicker value={deliveryDate} onChange={setDeliveryDate} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0C447C] transition-all" />
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
          <button onClick={handleConfirm} disabled={submitting} className="px-6 py-2.5 bg-[#0C447C] text-white font-bold rounded-xl hover:bg-blue-800 transition-colors shadow-md disabled:opacity-50">
            {submitting ? 'กำลังสร้างเที่ยวรถ...' : 'ยืนยันและเริ่มจัดออร์เดอร์'}
          </button>
        </div>
      </div>
    </div>
  );
}
