import React, { useState, useEffect } from 'react';
import { Settings, Save, X, Scale, AlertCircle, CheckCircle2 } from 'lucide-react';
import { fetchSystemSettings, updateSystemSettings } from '../../services/api';

interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SystemSettingsModal({ isOpen, onClose }: SystemSettingsModalProps) {
  const [minPct, setMinPct] = useState<string>('2.0');
  const [maxPct, setMaxPct] = useState<string>('5.0');
  const [standardBagKg, setStandardBagKg] = useState<string>('50.0');
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setErrorMsg('');
      setSuccessMsg('');
      fetchSystemSettings()
        .then(res => {
          if (res.settings) {
            setMinPct(String(res.settings.minPct ?? '2.0'));
            setMaxPct(String(res.settings.maxPct ?? '5.0'));
            setStandardBagKg(String(res.settings.standardBagKg ?? '50.0'));
          }
        })
        .catch(err => setErrorMsg(err.message || 'โหลดการตั้งค่าระบบไม่สำเร็จ'))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSave() {
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const min = parseFloat(minPct);
      const max = parseFloat(maxPct);
      const bag = parseFloat(standardBagKg);

      if (isNaN(min) || isNaN(max) || min < 0 || max < min) {
        throw new Error('กรุณาระบุช่วง Error Tolerance % ที่ถูกต้อง (Min ต้องไม่ติดลบ และ Max ต้องมากกว่า Min)');
      }
      if (isNaN(bag) || bag <= 0) {
        throw new Error('กรุณาระบุน้ำหนักกระสอบปุ๋ยมาตรฐานที่ถูกต้อง (> 0 กก.)');
      }

      await updateSystemSettings({
        WEIGHT_TOLERANCE_MIN_PCT: min,
        WEIGHT_TOLERANCE_MAX_PCT: max,
        STANDARD_BAG_WEIGHT_KG: bag,
      });

      setSuccessMsg('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว');
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1200);
    } catch (e: any) {
      setErrorMsg(e.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-[#0C447C] text-white">
          <h3 className="font-bold flex items-center gap-2 text-base">
            <Settings size={20} /> ตั้งค่าเครื่องชั่ง & Machine Calibration Error
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/20 text-white/80 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5 flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">⏳ กำลังโหลดตั้งค่าระบบ...</div>
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-xs text-blue-900 leading-relaxed flex items-start gap-2.5">
                <Scale size={18} className="text-[#0C447C] shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-[#0C447C] mb-0.5">การตั้งค่า Error เครื่องชั่ง (Calibration Tolerance)</div>
                  ตั้งค่าเปอร์เซ็นต์ส่วนต่างน้ำหนักรถชั่งออกที่ยอมรับได้ โดยเทียบกับน้ำหนักปุ๋ยมาตรฐาน (50 กก./กระสอบ) รวมกับของแถม
                </div>
              </div>

              {successMsg && (
                <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} /> {successMsg}
                </div>
              )}

              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertCircle size={16} /> {errorMsg}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    น้ำหนักกระสอบปุ๋ยมาตรฐาน (กก.)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={standardBagKg}
                    onChange={e => setStandardBagKg(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-gray-300 text-sm font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                    placeholder="50.0"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">ปกติปุ๋ย 1 ตัน = 20 กระสอบ (กระสอบละ 50.0 กิโลกรัม)</p>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Min Tolerance (%)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        value={minPct}
                        onChange={e => setMinPct(e.target.value)}
                        className="w-full p-2.5 pr-8 rounded-xl border border-gray-300 text-sm font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                        placeholder="2.0"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-gray-400 font-bold">%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">เกณฑ์ส่วนต่างขั้นต่ำ (เช่น +2.0%)</p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Max Tolerance (%)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        value={maxPct}
                        onChange={e => setMaxPct(e.target.value)}
                        className="w-full p-2.5 pr-8 rounded-xl border border-gray-300 text-sm font-bold text-gray-800 focus:border-[#0C447C] outline-none"
                        placeholder="5.0"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-gray-400 font-bold">%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">เกณฑ์ส่วนต่างสูงสุด (เช่น +5.0%)</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-xs bg-white hover:bg-gray-100"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex-1 py-2.5 rounded-xl text-white font-semibold text-xs bg-[#0C447C] hover:bg-[#093560] flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกตั้งค่า'}
          </button>
        </div>
      </div>
    </div>
  );
}
