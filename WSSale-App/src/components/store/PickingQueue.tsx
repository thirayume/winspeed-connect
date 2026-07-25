import { useState } from 'react';
import { Truck, Package, Unlock, ListOrdered, Scale, User, FileText, CalendarDays, Camera, Upload, FileImage, X } from 'lucide-react';
import { moveToPicking, confirmLoading, shipSO, unlockSO, fetchTruckScaleForSO } from '../../services/api';
import type { TruckScaleWeigh } from '../../types';
import type { SalesOrder } from '../../types';
import { AlertDialog } from '../ui/AlertDialog';
import { VisualTruckLoader } from './VisualTruckLoader';
import { SO_STATUS_META } from '../../constants/soStatus';

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

  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overridePhotoUrl, setOverridePhotoUrl] = useState<string>('');
  const [overrideApprovedByName, setOverrideApprovedByName] = useState<string>('');

  const [errorMsg, setErrorMsg] = useState<string>('');

  const formatTon = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

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
        overrideReason: overrideReason || undefined,
        overrideApprovedByName: overrideApprovedByName || undefined,
        evidencePhotoUrl: overridePhotoUrl || undefined,
      });
      setWeighOrder(null);
      setWeighWeight(''); setWeighTare(''); setWeighScale('1'); setWeighMovebill(''); setTsCandidates(null);
      setOverrideReason(''); setOverridePhotoUrl(''); setOverrideApprovedByName('');
      onUpdate();
    } catch (e: any) {
      setErrorMsg(e.message || 'Error');
    } finally {
      setBusy(null);
    }
  };

  if (orders.length === 0) {
    return (
      <div data-testid={`store-queue-${mode.toLowerCase()}`} className="flex flex-col items-center justify-center py-20 text-gray-300">
        <Package size={48} className="mb-3" />
        <p className="text-sm">ไม่มีรายการ{mode === 'LOADING' ? 'รอรับสินค้า' : 'รอชั่งออก'}</p>
      </div>
    );
  }

  return (
    <div data-testid={`store-queue-${mode.toLowerCase()}`} className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4 p-2 sm:p-4">
      {orders.map(order => {
        const orderId = Number(order.id);
        const productLines = (order.lines || []).filter(l => !l.isGiveaway);
        const giveawayLines = (order.lines || []).filter(l => l.isGiveaway);
        const totalTon = productLines.reduce((s, l) => s + (Number(l.qtyTon) || 0), 0);
        const isBusy = busy === orderId;
        const statusMeta = SO_STATUS_META[order.status];
        const dateText = (order.deliveryDate || order.requestedAt || order.createdAt || '').slice(0, 10);
        const plateText = order.noTruckRequired ? 'ไม่ต้องระบุรถ' : (order.truckPlate || 'ไม่ระบุรถ');
        const visibleLines = productLines.slice(0, 4);
        const moreLines = Math.max(productLines.length - visibleLines.length, 0);
        const cardTone = order.status === 'PICKING'
          ? 'border-emerald-200 bg-emerald-50/40'
          : order.status === 'LOADED'
            ? 'border-blue-200 bg-blue-50/40'
            : 'border-amber-200 bg-white';

        return (
          <div key={order.id || order.wfRef} data-testid={`store-order-${order.id}`} className={`rounded-xl border p-3 sm:p-4 shadow-sm flex flex-col gap-3 ${cardTone}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusMeta?.badgeClass || 'bg-gray-50 text-gray-600 border-gray-100'}`}>
                    {statusMeta?.label || order.status}
                  </span>
                  {dateText && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                      <CalendarDays size={12} /> {dateText}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-9 w-9 rounded-lg bg-[#0C447C] text-white flex items-center justify-center shrink-0">
                    <Truck size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-lg font-black text-gray-900 font-mono truncate" title={plateText}>
                      {plateText}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {order.isOwnTruck ? 'รถบริษัท' : 'รถลูกค้า/ขนส่ง'}
                      {order.pSling ? ' · P-Sling' : ''}
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-gray-500">รวมสินค้า</div>
                <div className="text-xl font-black text-[#0C447C]">{formatTon(totalTon)}</div>
                <div className="text-[11px] text-gray-400">ตัน</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 rounded-lg border border-white/70 bg-white/85 p-2.5">
              <div className="flex items-start gap-2 min-w-0">
                <User size={14} className="mt-0.5 text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-400">ลูกค้า</div>
                  <div className="text-sm font-bold text-gray-900 truncate" title={order.custName}>{order.custName}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 min-w-0">
                <FileText size={14} className="mt-0.5 text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-400">เอกสาร</div>
                  <div className="font-mono text-sm font-bold text-[#0C447C] truncate">
                    {order.wfRef || order.importedDocuNo || `#${order.id}`}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 bg-white p-2.5 flex-1">
              <div className="mb-2 flex items-center justify-between">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-700">
                  <Package size={14} /> รายการสินค้า
                </div>
                <div className="text-[11px] text-gray-400">{productLines.length} รายการ</div>
              </div>
              <div className="space-y-1.5">
                {visibleLines.length === 0 ? (
                  <div className="rounded-md bg-gray-50 px-2 py-3 text-center text-xs text-gray-400">ไม่พบรายการสินค้า</div>
                ) : visibleLines.map((line, i) => (
                  <div key={`${line.lineNo || i}-${line.goodId}`} className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-800 truncate" title={line.goodName}>{line.goodName}</div>
                      <div className="font-mono text-[11px] text-gray-400 truncate">{line.goodCode}</div>
                    </div>
                    <div className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-black text-[#0C447C] border border-gray-100">
                      {formatTon(Number(line.qtyTon) || 0)} ตัน
                    </div>
                  </div>
                ))}
                {moreLines > 0 && (
                  <div className="rounded-md bg-blue-50 px-2 py-1.5 text-xs font-bold text-[#0C447C] text-center">
                    + อีก {moreLines} รายการ
                  </div>
                )}
                {giveawayLines.length > 0 && (
                  <div className="rounded-md bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-700 border border-amber-100">
                    ของแถม {giveawayLines.length} รายการ
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-auto">
              {mode === 'LOADING' && order.status === 'CONFIRMED' && (
                <button
                  disabled={isBusy}
                  onClick={() => doAction(orderId, () => moveToPicking(orderId))}
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
                      const note = prompt('เหตุผลในการปลดล็อก (รออนุมัติEMP-00019):');
                      if (note !== null) doAction(orderId, () => unlockSO(orderId, note));
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
        <div data-testid="weigh-out-modal" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-blue-50/50 shrink-0">
              <h3 className="font-bold text-[#0C447C] flex items-center gap-2">
                <Scale size={18} /> ระบุน้ำหนักชั่งออก & ตรวจสอบ Error เครื่องชั่ง
              </h3>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <div className="text-center bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <div className="text-lg font-black font-mono text-gray-800">{weighOrder.truckPlate}</div>
                <div className="text-xs text-gray-500">{weighOrder.custName} · เอกสาร {weighOrder.wfRef || weighOrder.importedDocuNo}</div>
              </div>

              {/* Theoretical Expected Target Weight */}
              {(() => {
                const pLines = (weighOrder.lines || []).filter(l => !l.isGiveaway);
                const totalTon = pLines.reduce((s, l) => s + (Number(l.qtyTon) || 0), 0);
                const expNet = totalTon * 1000; // 50kg bag standard
                const minAllowed = expNet * 1.02; // +2%
                const maxAllowed = expNet * 1.05; // +5%

                const g = parseFloat(weighWeight);
                const t = parseFloat(weighTare);
                const actualNet = (!isNaN(g) && !isNaN(t)) ? g - t : null;

                let badge = null;
                let isAbnormal = false;
                if (actualNet !== null && actualNet > 0) {
                  if (actualNet >= minAllowed && actualNet <= maxAllowed) {
                    badge = (
                      <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2 text-xs font-semibold flex items-center justify-between">
                        <span>🟢 ปกติ (ตรงตามเกณฑ์ Error เครื่องชั่ง +2% ถึง +5%)</span>
                        <span className="font-mono">{actualNet.toLocaleString()} กก.</span>
                      </div>
                    );
                  } else if (actualNet < minAllowed) {
                    isAbnormal = true;
                    const diff = minAllowed - actualNet;
                    badge = (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2 text-xs font-semibold flex items-center justify-between">
                        <span>🟡 น้ำหนักต่ำกว่าเกณฑ์ (-{diff.toLocaleString()} กก.)</span>
                        <span className="font-mono">เกณฑ์ขั้นต่ำ: {minAllowed.toLocaleString()} กก.</span>
                      </div>
                    );
                  } else {
                    isAbnormal = true;
                    const diff = actualNet - maxAllowed;
                    badge = (
                      <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-xs font-semibold flex items-center justify-between">
                        <span>🔴 น้ำหนักเกินเกณฑ์ (+{diff.toLocaleString()} กก.)</span>
                        <span className="font-mono">เกณฑ์สูงสุด: {maxAllowed.toLocaleString()} กก.</span>
                      </div>
                    );
                  }
                }

                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">ชั่งเข้า / รถเปล่า (กก.)</label>
                        <input data-testid="weigh-tare" type="number" step="1" value={weighTare} onChange={e => setWeighTare(e.target.value)} placeholder="0"
                          className="w-full text-center text-lg font-bold p-2.5 rounded-xl border border-gray-300 focus:border-[#0C447C] outline-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">ชั่งออก / รถ+สินค้า (กก.)</label>
                        <input data-testid="weigh-gross" type="number" step="1" autoFocus value={weighWeight} onChange={e => setWeighWeight(e.target.value)} placeholder="0"
                          className="w-full text-center text-lg font-bold p-2.5 rounded-xl border border-gray-300 focus:border-[#0C447C] outline-none" />
                      </div>
                    </div>

                    {/* Weight Reconciliation Summary */}
                    <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100 text-xs space-y-1.5">
                      <div className="flex justify-between text-gray-600">
                        <span>น้ำหนักคำนวณตามทฤษฎี (50 กก./กระสอบ):</span>
                        <span className="font-bold text-gray-900 font-mono">{expNet.toLocaleString()} กก. ({totalTon} ตัน)</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>ช่วงเกณฑ์ยอมรับ (+2% ถึง +5% Calibrate):</span>
                        <span className="font-mono font-semibold text-blue-700">{minAllowed.toLocaleString()} - {maxAllowed.toLocaleString()} กก.</span>
                      </div>
                      <div className="flex justify-between text-gray-800 font-bold text-sm pt-1 border-t border-blue-100">
                        <span>น้ำหนักสุทธิจริง (Net):</span>
                        <span className="text-[#0C447C] font-mono">{actualNet !== null ? `${actualNet.toLocaleString()} กก.` : '—'}</span>
                      </div>
                    </div>

                    {badge}

                    {/* Weighbridge Discretion & Evidence Photo Section (When Weight is Abnormal) */}
                    {isAbnormal && (
                      <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-3 animate-in fade-in">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                            <Scale size={15} /> บันทึกดุลยพินิจของนายด่านชั่ง (Weighbridge Discretion)
                          </span>
                          <span className="text-[10px] text-amber-700 font-medium">อนุญาตผ่านชั่งออก</span>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-gray-700 mb-1">
                            เหตุผลที่อนุญาตผ่าน <span className="text-red-500">*</span>
                          </label>
                          <textarea
                            rows={2}
                            value={overrideReason}
                            onChange={e => setOverrideReason(e.target.value)}
                            placeholder="ระบุเหตุผล เช่น มีของแถมปนติดไปบนท้ายรถ, ชั่งรวมพาเลทไม้..."
                            className="w-full text-xs p-2 rounded-lg border border-amber-300 focus:border-[#0C447C] outline-none bg-white"
                          />
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {[
                              'มีของแถม (เสื้อ/กระเป๋า/ป้าย) บรรทุกปนบนรถ',
                              'ชั่งรวมพาเลทไม้/โครงเหล็กเสริม',
                              'รถมีอุปกรณ์เสริม/ถังน้ำมันดัดแปลง',
                              'ได้รับอนุมัติดุลยพินิจจากหัวหน้าคลัง'
                            ].map((chip, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setOverrideReason(chip)}
                                className="text-[10px] px-2 py-0.5 bg-white border border-amber-200 text-amber-800 rounded-full hover:bg-amber-100 transition-colors"
                              >
                                + {chip}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-amber-200/50">
                          <div>
                            <label className="block text-[11px] font-bold text-gray-700 mb-1">
                              ผู้อนุญาตให้ผ่าน
                            </label>
                            <input
                              type="text"
                              value={overrideApprovedByName}
                              onChange={e => setOverrideApprovedByName(e.target.value)}
                              placeholder="ชื่อ-นามสกุล ผู้อนุญาต"
                              className="w-full text-xs p-2 rounded-lg border border-amber-300 focus:border-[#0C447C] outline-none bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-gray-700 mb-1">
                              แนบหลักฐานภาพถ่าย
                            </label>
                            <label className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-white border border-amber-300 rounded-lg text-xs text-amber-900 cursor-pointer hover:bg-amber-100 transition-colors font-medium">
                              <Camera size={14} />
                              <span>{overridePhotoUrl ? 'เปลี่ยนรูป' : 'ถ่าย/เลือกรูป'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={e => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const reader = new FileReader();
                                    reader.onloadend = () => setOverridePhotoUrl(reader.result as string);
                                    reader.readAsDataURL(file);
                                  }
                                }}
                              />
                            </label>
                          </div>
                        </div>

                        {/* Photo Evidence Preview */}
                        {overridePhotoUrl && (
                          <div className="relative mt-2 border border-amber-300 rounded-lg overflow-hidden bg-black/5 flex items-center justify-between p-2">
                            <div className="flex items-center gap-2">
                              <img src={overridePhotoUrl} alt="Evidence" className="w-12 h-12 object-cover rounded" />
                              <span className="text-[11px] font-medium text-amber-900 flex items-center gap-1">
                                <FileImage size={14} /> รูปภาพหลักฐานแนบเรียบร้อย
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setOverridePhotoUrl('')}
                              className="p-1 rounded-full bg-white text-gray-500 hover:text-red-600 hover:bg-red-50"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">เครื่องชั่ง</label>
                  <select value={weighScale} onChange={e => setWeighScale(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-sm">
                    <option value="1">เครื่องชั่ง 1</option><option value="2">เครื่องชั่ง 2</option>
                  </select>
                </div>
              </div>

              {/* TruckScale Pull Button */}
              <div>
                <button onClick={loadTsCandidates} disabled={tsLoading}
                  className="w-full py-2 rounded-lg border border-[#0C447C] text-[#0C447C] text-xs font-semibold hover:bg-[#E6F1FB] flex items-center justify-center gap-1.5 disabled:opacity-50">
                  {tsLoading ? '⏳ กำลังดึง...' : `🔗 ดึงน้ำหนักอัตโนมัติจาก db_truckscale (${weighOrder.truckPlate || '-'})`}
                </button>
                {weighMovebill && <div className="text-[11px] text-green-600 mt-1 text-center font-mono">✓ เชื่อม TruckScale · Movebill {weighMovebill}</div>}
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
            </div>

            <div className="p-4 border-t border-gray-100 flex gap-2 bg-gray-50 shrink-0">
              <button
                onClick={() => { setWeighOrder(null); setWeighWeight(''); setWeighTare(''); setWeighScale('1'); setWeighMovebill(''); setTsCandidates(null); }}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-medium text-sm bg-white hover:bg-gray-100"
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleConfirmWeighOut}
                disabled={busy !== null || !weighWeight}
                className="flex-1 py-2.5 rounded-lg text-white font-medium text-sm bg-[#0C447C] hover:bg-[#093560] disabled:opacity-50"
              >
                {busy ? 'กำลังบันทึก...' : 'บันทึกน้ำหนัก & ส่งออก'}
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
