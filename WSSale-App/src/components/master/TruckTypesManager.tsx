import { useEffect, useState, useMemo } from 'react';
import { fetchTruckTypes, createTruckType, updateTruckType, deleteTruckType } from '../../services/api';
import { Truck, Plus, RefreshCw, X, Save, Edit2, Trash2, Settings } from 'lucide-react';
import type { TruckType } from '../../types';
import { appConfirm, appPrompt } from '../ui/AppAlert';

export const TruckTypesManager = () => {
  const [loading, setLoading] = useState(true);
  const [truckTypes, setTruckTypes] = useState<TruckType[]>([]);
  const [editingItem, setEditingItem] = useState<TruckType | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchTruckTypes();
      setTruckTypes(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleEdit = (item: TruckType) => {
    setEditingItem({ ...item });
    setIsNew(false);
  };

  const handleAddNew = () => {
    setEditingItem({
      Id: '',
      Name: '',
      MaxWeightMain: 15,
      MaxWeightTrailer: null,
      IsActive: true
    });
    setIsNew(true);
  };

  const handleSave = async () => {
    if (!editingItem) return;
    if (!editingItem.Id || !editingItem.Name) {
      alert('กรุณากรอกรหัสและชื่อประเภทรถ');
      return;
    }

    setBusy(true);
    try {
      if (isNew) {
        await createTruckType(editingItem);
      } else {
        await updateTruckType(editingItem.Id, editingItem);
      }
      setEditingItem(null);
      await loadData();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (await appConfirm(`คุณแน่ใจหรือไม่ที่จะลบประเภทรถรหัส ${id}?`)) {
      setBusy(true);
      try {
        await deleteTruckType(id);
        await loadData();
      } catch (e) {
        alert((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-none sm:rounded-2xl shadow-sm sm:shadow-sm border-y sm:border border-gray-100 overflow-hidden relative">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
        <div className="flex items-center gap-2 text-[#0C447C] font-bold">
          <Truck size={18} />
          <span>ประเภทรถและข้อกำหนดน้ำหนัก (Truck Types)</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleAddNew} className="flex items-center gap-1 bg-[#0C447C] hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors">
            <Plus size={16} /> เพิ่มใหม่
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 bg-gray-50/30">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#0C447C]">
            <RefreshCw size={32} className="animate-spin mb-4 opacity-50" />
            <p className="text-sm font-medium animate-pulse opacity-70">กำลังโหลดข้อมูล...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {truckTypes.map(t => (
              <div key={t.Id} className={`bg-white border rounded-xl p-4 shadow-sm transition-all ${t.IsActive ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-blue-50 text-blue-700 font-bold px-2 py-1 rounded text-sm font-mono border border-blue-100">
                      {t.Id}
                    </div>
                    {t.IsActive === false && (
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">ปิดใช้งาน</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleEdit(t)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDelete(t.Id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                
                <h3 className="font-bold text-gray-800 text-lg mb-4">{t.Name}</h3>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 col-span-2">
                    <div className="text-xs text-gray-500 mb-0.5">ลิมิตน้ำหนัก ตัวแม่ (ตัน)</div>
                    <div className="font-semibold text-gray-800">{t.MaxWeightMain?.toFixed(2) || '0.00'} ตัน</div>
                  </div>
                  {t.MaxWeightTrailer != null && t.MaxWeightTrailer > 0 && (
                    <div className="bg-amber-50 p-2 rounded-lg border border-amber-100 col-span-2">
                      <div className="text-xs text-amber-700 mb-0.5">ลิมิตน้ำหนัก ตัวลูก (ตัน)</div>
                      <div className="font-semibold text-amber-900">{t.MaxWeightTrailer.toFixed(2)} ตัน</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {truckTypes.length === 0 && (
              <div className="col-span-full py-12 text-center text-gray-400">
                ไม่มีข้อมูลประเภทรถบรรทุก
              </div>
            )}
          </div>
        )}
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Settings size={18} className="text-[#0C447C]" />
                {isNew ? 'เพิ่มประเภทรถใหม่' : `แก้ไขประเภทรถ: ${editingItem.Id}`}
              </h3>
              <button onClick={() => setEditingItem(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
              {isNew && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">รหัสประเภทรถ (ID)*</label>
                  <input
                    type="text"
                    value={editingItem.Id}
                    onChange={e => setEditingItem({ ...editingItem, Id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="เช่น 10w, 6w"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">รหัสต้องเป็นภาษาอังกฤษหรือตัวเลข (ห้ามเว้นวรรค) และห้ามซ้ำ</p>
                </div>
              )}
              
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">ชื่อประเภทรถ*</label>
                <input
                  type="text"
                  value={editingItem.Name}
                  onChange={e => setEditingItem({ ...editingItem, Name: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="เช่น รถ 10 ล้อ"
                />
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">ลิมิตน้ำหนักรวม ตัวแม่ (ตัน)*</label>
                  <input
                    type="number" step="0.1" min={1} max={100}
                    value={editingItem.MaxWeightMain}
                    onChange={e => setEditingItem({ ...editingItem, MaxWeightMain: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-bold text-[#0C447C]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">ลิมิตน้ำหนักรวม ตัวลูก (ตัน) - ถ้าไม่มีพ่วงให้ใส่ 0</label>
                <input
                  type="number" step="0.1" min={0} max={100}
                  value={editingItem.MaxWeightTrailer || 0}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setEditingItem({ ...editingItem, MaxWeightTrailer: val > 0 ? val : null });
                  }}
                  className="w-full border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>

              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingItem.IsActive !== false}
                  onChange={e => setEditingItem({ ...editingItem, IsActive: e.target.checked })}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">เปิดใช้งาน (Active)</span>
              </label>
            </div>

            <div className="p-4 border-t border-gray-100 flex gap-3 bg-gray-50">
              <button 
                onClick={() => setEditingItem(null)} 
                className="flex-1 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
                disabled={busy}
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleSave} 
                className="flex-1 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-blue-500/25 shadow-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                disabled={busy}
              >
                {busy ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                บันทึกข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
