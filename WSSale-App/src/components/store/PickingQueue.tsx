import { useState } from 'react';
import { Truck, Package, CheckCircle, Unlock, ListOrdered, Scale } from 'lucide-react';
import { moveToPicking, confirmLoading, shipSO, unlockSO, fetchTruckScaleForSO } from '../../services/api';
import type { TruckScaleWeigh } from '../../types';
import type { SalesOrder } from '../../types';
import { AlertDialog } from '../ui/AlertDialog';
import { VisualTruckLoader } from './VisualTruckLoader';

export const PickingQueue = ({ orders, onUpdate, mode }: { orders: SalesOrder[]; onUpdate: () => void, mode: 'LOADING' | 'SCALE' }) => {
  const [busy, setBusy] = useState<number | null>(null);
  
  // Modal states
  const [sequenceOrder, setSequenceOrder] = useState<SalesOrder | null>(null);
  
  const [weighOrder, setWeighOrder] = useState<SalesOrder | null>(null);
  const [weighWeight, setWeighWeight] = useState<string>('');   // Gross (kg)
  const [weighTare, setWeighTare] = useState<string>('');       // Tare (kg)
  const [weighScale, setWeighScale] = useState<string>('1');    // เครื่องชั่ง
  const [weighMovebill, setWeighMovebill] = useState<string>(''); // จาก TruckScale
  const [tsCandidates, setTsCandidates] = useState<TruckScaleWeigh[] | null>(null);
  const [tsLoading, setTsLoading] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string>('');

  async function doAction(soId: number, fn: () => Promise<unknown>) {
    setBusy(soId);
    try { await fn(); onUpdate(); }
    catch (e: unknown) { setErrorMsg((e as Error).message || 'เกิดข้อผิดพลาดในการดำเนินการ'); }
    finally { setBusy(null); }
  }

  const handleConfirmSequence = async (seqMapping: Record<number, number>) => {
    if (!sequenceOrder) return;
    
    const seqArray = Object.entries(seqMapping).map(([lineNo, seq]) => ({
      lineNum: Number(lineNo),
      seq
    }));
    
    setBusy(Number(sequenceOrder.id));
    try {
      await confirmLoading(Number(sequenceOrder.id), seqArray);
      setSequenceOrder(null);
      onUpdate();
    } catch (e: any) {
      setErrorMsg(e.message || 'Error');
    } finally {
      setBusy(null);
    }
  };

  const loadTsCandidates = async () => {
    if (!weighOrder) return;
    setTsLoading(true);
    try {
      const r = await fetchTruckScaleForSO(Number(weighOrder.id));
      setTsCandidates(r.candidates || []);
    } catch (e: any) { setErrorMsg(e.message || 'ดึงข้อมูล TruckScale ไม่สำเร็จ'); setTsCandidates([]); }
    finally { setTsLoading(false); }
  };

  const pickTs = (c: TruckScaleWeigh) => {
    setWeighTare(String(c.WeightIn));
    setWeighWeight(String(c.WeightOut));
    setWeighScale(String(c.ScaleNo || 1));
    setWeighMovebill(c.Movebill);
    setTsCandidates(null);
  };

  const handleConfirmWeighOut = async () => {
    if (!weighOrder) return;
    const weight = parseFloat(weighWeight);
    if (isNaN(weight) || weight <= 0) {
      setErrorMsg('กรุณาระบุน้ำหนักที่ถูกต้อง');
      return;
    }
    
    const tare = parseFloat(weighTare);
    setBusy(Number(weighOrder.id));
    try {
      await shipSO(Number(weighOrder.id), weight, {
        tareKg: !isNaN(tare) && tare > 0 ? tare : undefined,
        scaleNo: weighScale ? Number(weighScale) : undefined,
        movebill: weighMovebill || undefined,
      });
      setWeighOrder(null);
      setWeighWeight(''); setWeighTare(''); setWeighScale('1'); setWeighMovebill(''); setTsCandidates(null);
      onUpdate();
    } catch (e: any) {
      setErrorMsg(e.message || 'Error');
    } finally {
      setBusy(null);
    }
  };

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-300">
        <Package size={48} className="mb-3" />
        <p className="text-sm">ไม่มีรายการ{mode === 'LOADING' ? 'รอรับสินค้า' : 'รอชั่งออก'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 sm:space-y-3 p-2 sm:p-4">
      {orders.map(order => {
        const totalTon = (order.lines || []).filter(l => !l.isGiveaway).reduce((s, l) => s + l.qtyTon, 0);
        const isBusy = busy === order.id;

        return (
          <div key={order.id} className="bg-white rounded-none sm:rounded-xl border-y sm:border border-gray-100 p-3 sm:p-4 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div>
                <span className="font-mono text-sm font-bold text-gray-800">{order.wfRef}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full border ${
                  order.status === 'LOADED' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                  order.status === 'PICKING' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                  'bg-amber-50 text-amber-700 border-amber-100'
                }`}>
                  {order.status}
                </span>
              </div>
              <div className="text-xs text-gray-400">{order.createdAt?.slice(0, 10)}</div>
            </div>

            <div className="text-sm text-gray-700 mb-1 font-medium">{order.custName}</div>

            {order.truckPlate && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
                <Truck size={12} />
                <span className="font-mono">{order.truckPlate}</span>
              </div>
            )}

            <div className="text-xs text-gray-400 mb-3">
              {(order.lines || []).filter(l => !l.isGiveaway).map((l, i) =>
                <span key={`${l.lineNo || i}-${l.goodId}`} className="mr-2">{l.goodCode} {l.qtyTon.toFixed(2)}ตัน</span>
              )}
              <span className="font-semibold text-gray-600">รวม {totalTon.toFixed(3)} ตัน</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              {mode === 'LOADING' && order.status === 'CONFIRMED' && (
                <button
                  disabled={isBusy}
                  onClick={() => doAction(Number(order.id), () => moveToPicking(Number(order.id)))}
                  className="flex-1 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
                  style={{ background: '#F59E0B' }}
                >
                  เริ่มรับสินค้า
                </button>
              )}
              
              {mode === 'LOADING' && order.status === 'PICKING' && (
                <>
                  <button
                    disabled={isBusy}
                    onClick={() => setSequenceOrder(order)}
                    className="flex-1 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                    style={{ background: '#059669' }}
                  >
                    <ListOrdered size={13} /> จัดลำดับ & ยืนยันโหลด
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => {
                      const note = prompt('เหตุผลในการปลดล็อก (รออนุมัติสุรชัย):');
                      if (note !== null) doAction(Number(order.id), () => unlockSO(Number(order.id), note));
                    }}
                    className="px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-1"
                  >
                    <Unlock size={12} /> ปลดล็อก
                  </button>
                </>
              )}

              {mode === 'SCALE' && order.status === 'LOADED' && (
                <button
                  disabled={isBusy}
                  onClick={() => setWeighOrder(order)}
                  className="flex-1 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                  style={{ background: '#2563EB' }}
                >
                  <Scale size={13} /> ระบุน้ำหนักชั่งออก
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Load Sequence Modal */}
      {sequenceOrder && (
        <VisualTruckLoader 
          order={sequenceOrder} 
          onConfirm={handleConfirmSequence} 
          onCancel={() => setSequenceOrder(null)} 
        />
      )}

      {/* Weigh Out Modal */}
      {weighOrder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-[#0C447C] flex items-center gap-2">
                <Scale size={18} /> ระบุน้ำหนักชั่งออก
              </h3>
            </div>
            <div className="p-6">
              <div className="mb-4 text-center">
                <div className="text-xl font-bold font-mono text-gray-800">{weighOrder.truckPlate}</div>
                <div className="text-sm text-gray-500">{weighOrder.custName}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">ชั่งเข้า / รถเปล่า (กก.)</label>
                  <input type="number" step="1" value={weighTare} onChange={e => setWeighTare(e.target.value)} placeholder="0"
                    className="w-full text-center text-lg font-bold p-2.5 rounded-xl border border-gray-300 focus:border-[#0C447C] outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">ชั่งออก / รถ+สินค้า (กก.)</label>
                  <input type="number" step="1" autoFocus value={weighWeight} onChange={e => setWeighWeight(e.target.value)} placeholder="0"
                    className="w-full text-center text-lg font-bold p-2.5 rounded-xl border border-gray-300 focus:border-[#0C447C] outline-none" />
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">เครื่องชั่ง</label>
                  <select value={weighScale} onChange={e => setWeighScale(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-sm">
                    <option value="1">1</option><option value="2">2</option>
                  </select>
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-500">สุทธิ</span>
                  <div className="text-lg font-bold text-[#0C447C]">
                    {(() => { const g = parseFloat(weighWeight), t = parseFloat(weighTare); const n = (!isNaN(g) && !isNaN(t)) ? g - t : NaN;
                      return isNaN(n) ? '—' : `${n.toLocaleString()} กก. (${(n/1000).toFixed(2)} ตัน)`; })()}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-2">
              <button onClick={loadTsCandidates} disabled={tsLoading}
                className="w-full py-2 rounded-lg border border-[#0C447C] text-[#0C447C] text-sm font-semibold hover:bg-[#E6F1FB] flex items-center justify-center gap-1.5 disabled:opacity-50">
                {tsLoading ? '⏳ กำลังดึง...' : `🔗 ดึงน้ำหนักจาก TruckScale (${weighOrder.truckPlate || '-'})`}
              </button>
              {weighMovebill && <div className="text-[11px] text-green-600 mt-1 text-center">✓ จาก TruckScale · Movebill {weighMovebill}</div>}
              {tsCandidates && (
                <div className="mt-2 max-h-40 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                  {tsCandidates.length === 0 ? (
                    <div className="text-xs text-gray-400 text-center py-3">ไม่พบใบชั่งของทะเบียนนี้</div>
                  ) : tsCandidates.map(c => (
                    <button key={c.Sequence} onClick={() => pickTs(c)} className="w-full text-left px-3 py-2 hover:bg-blue-50/50 text-xs flex items-center justify-between">
                      <span><b className="font-mono">{c.Movebill}</b> · {c.DateOut !== '0' ? c.DateOut : '-'}</span>
                      <span className="text-[#0C447C] font-bold">{Number(c.WeightNet).toLocaleString()} กก.</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 flex gap-2 bg-gray-50">
              <button
                onClick={() => { setWeighOrder(null); setWeighWeight(''); setWeighTare(''); setWeighScale('1'); setWeighMovebill(''); setTsCandidates(null); }}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-medium text-sm bg-white"
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleConfirmWeighOut}
                disabled={busy !== null || !weighWeight}
                className="flex-1 py-2.5 rounded-lg text-white font-medium text-sm bg-blue-600 disabled:opacity-50"
              >
                {busy ? 'กำลังบันทึก...' : 'ยืนยัน / ส่งออก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Error Modal */}
      <AlertDialog 
        isOpen={!!errorMsg} 
        onClose={() => setErrorMsg('')} 
        title="พบข้อผิดพลาด" 
        message={errorMsg} 
      />
    </div>
  );
};
