import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Truck, X, ArrowRight, CheckCircle2, Package, Info, Weight, Settings } from 'lucide-react';
import { Button, cn } from '../ui/Base';
import type { SalesOrder, SalesOrderLine } from '../../types';
import { useSettingsStore } from '../../store/settings-store';

const STACKING_GUIDE_IMG = "/bag_stacking_guide_1782372817658.png";

interface TruckConfig {
  id: string;
  name: string;
  slotCount: number;
  trailerSlotCount?: number;
  maxTonPerSlot: number;
}

const TRUCK_TYPES: TruckConfig[] = [
  { id: '6w', name: 'รถ 6 ล้อ', slotCount: 4, maxTonPerSlot: 2.5 },
  { id: '10w', name: 'รถ 10 ล้อ', slotCount: 6, maxTonPerSlot: 2.5 },
  { id: 'trailer', name: 'รถพ่วง', slotCount: 6, trailerSlotCount: 6, maxTonPerSlot: 3.0 },
  { id: 'container', name: 'ตู้คอนเทนเนอร์', slotCount: 8, maxTonPerSlot: 3.5 }
];

export const VisualTruckLoader = ({ 
  order, 
  onConfirm, 
  onCancel 
}: { 
  order: SalesOrder; 
  onConfirm: (sequences: Record<number, number>) => void;
  onCancel: () => void;
}) => {
  const linesWithId = useMemo(() => {
    return (order.lines || []).filter(l => !l.isGiveaway).map((l, idx) => ({
      ...l,
      uid: l.lineNum || l.id || `fallback-${idx}`
    }));
  }, [order.lines]);

  const truckPayloadLimits = useSettingsStore(s => s.truckPayloadLimits);
  const setTruckPayloadLimit = useSettingsStore(s => s.setTruckPayloadLimit);
  
  const [truckType, setTruckType] = useState<TruckConfig>(() => {
    if (order.truckPlate && order.truckPlate.includes('/')) return TRUCK_TYPES[2];
    return TRUCK_TYPES[1];
  });
  
  // Use global limits if set, otherwise fallback to default
  const currentMaxTonPerSlot = truckPayloadLimits?.[truckType.id] || truckType.maxTonPerSlot;

  const [unassigned, setUnassigned] = useState<typeof linesWithId>([]);
  const [assigned, setAssigned] = useState<Record<number, typeof linesWithId>>({});
  const [selectedLine, setSelectedLine] = useState<typeof linesWithId[0] | null>(null);
  const [showStackingGuide, setShowStackingGuide] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [draggedUid, setDraggedUid] = useState<string | null>(null);

  // Auto-assignment
  useEffect(() => {
    let currentSlot = 1;
    const initialAssigned: Record<number, typeof linesWithId> = {};
    const initialUnassigned: typeof linesWithId = [];
    const maxSlots = truckType.slotCount + (truckType.trailerSlotCount || 0);

    linesWithId.forEach((l) => {
      if (l.loadSequence && l.loadSequence > 0 && l.loadSequence <= maxSlots) {
         if (!initialAssigned[l.loadSequence]) initialAssigned[l.loadSequence] = [];
         initialAssigned[l.loadSequence].push(l);
      } else {
         const currentWeight = (initialAssigned[currentSlot] || []).reduce((sum, item) => sum + item.qtyTon, 0);
         
         if (currentWeight > 0 && currentWeight + l.qtyTon > currentMaxTonPerSlot) {
            currentSlot++;
            if (currentSlot > maxSlots) currentSlot = 1;
         }
         
         if (!initialAssigned[currentSlot]) initialAssigned[currentSlot] = [];
         initialAssigned[currentSlot].push(l);
      }
    });

    setAssigned(initialAssigned);
    setUnassigned(initialUnassigned);
    setSelectedLine(null);
  }, [linesWithId, truckType]);

  const handleAssign = (slotNo: number) => {
    if (!selectedLine) return;
    setAssigned(prev => ({
      ...prev,
      [slotNo]: [...(prev[slotNo] || []), selectedLine]
    }));
    setUnassigned(prev => prev.filter(l => l.uid !== selectedLine.uid));
    setSelectedLine(null);
  };

  const handleUnassign = (slotNo: number, line: typeof linesWithId[0], e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAssigned(prev => ({
      ...prev,
      [slotNo]: prev[slotNo].filter(l => l.uid !== line.uid)
    }));
    setUnassigned(prev => {
      if (prev.some(l => l.uid === line.uid)) return prev;
      return [...prev, line];
    });
  };

  const handleDropToSlot = (slotNo: number, uid: string) => {
    const line = linesWithId.find(l => String(l.uid) === uid);
    if (!line) return;

    // Remove from unassigned
    setUnassigned(prev => prev.filter(l => String(l.uid) !== uid));

    // Remove from any assigned slot
    setAssigned(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
         next[Number(k)] = next[Number(k)].filter(l => String(l.uid) !== uid);
      });
      // Add to new slot
      next[slotNo] = [...(next[slotNo] || []), line];
      return next;
    });
    setSelectedLine(null);
  };

  const handleConfirm = () => {
    if (unassigned.length > 0) {
      alert('กรุณาจัดวางสินค้าให้ครบทุกรายการ');
      return;
    }
    const seqMapping: Record<number, number> = {};
    Object.entries(assigned).forEach(([slotStr, lines]) => {
      const slotNo = Number(slotStr);
      lines.forEach(l => {
        if (l.lineNum) seqMapping[l.lineNum] = slotNo;
      });
    });
    onConfirm(seqMapping);
  };

  const renderTruckBed = (startIdx: number, count: number, label: string) => {
    return (
      <div className="flex flex-col border-[3px] border-slate-700 rounded-lg bg-slate-50 shadow-inner overflow-hidden shrink-0">
        <div className="bg-slate-700 text-white text-center text-[10px] uppercase tracking-widest py-1 font-bold">{label}</div>
        <div className="flex flex-row divide-x-2 divide-dashed divide-slate-300 min-h-[260px]">
          {Array.from({ length: count }).map((_, i) => {
            const slotIdx = startIdx + i;
            const lines = assigned[slotIdx] || [];
            const totalWeight = lines.reduce((acc, curr) => acc + curr.qtyTon, 0);
            const isOverloaded = totalWeight > currentMaxTonPerSlot;

            return (
              <div 
                key={slotIdx}
                onClick={() => handleAssign(slotIdx)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const uid = e.dataTransfer.getData('uid');
                  if (uid) handleDropToSlot(slotIdx, uid);
                }}
                className={cn(
                  "relative w-[150px] p-2 transition-all flex flex-col gap-2 items-center justify-start cursor-pointer hover:bg-blue-50/50",
                  lines.length > 0 ? (isOverloaded ? 'bg-red-50' : 'bg-amber-50') : 'bg-slate-100/50',
                  draggedUid && "border-2 border-dashed border-blue-400"
                )}
              >
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
                  <span className="text-6xl font-black">{slotIdx}</span>
                </div>
                
                {/* Weight Warning Indicator */}
                <div className={cn(
                  "z-10 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 w-full justify-center shadow-sm border",
                  lines.length === 0 ? "bg-white text-slate-400 border-slate-200" :
                  isOverloaded ? "bg-red-100 text-red-700 border-red-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"
                )}>
                  {lines.length > 0 && isOverloaded && <span>⚠️</span>}
                  {totalWeight.toFixed(2)}t / {currentMaxTonPerSlot.toFixed(1)}t
                </div>

                <div className="flex-1 w-full overflow-y-auto space-y-2 z-10 pr-1">
                  {lines.map(line => (
                    <motion.div 
                      layoutId={`line-${line.uid}`}
                      key={line.uid} 
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('uid', String(line.uid));
                        setDraggedUid(String(line.uid));
                      }}
                      onDragEnd={() => setDraggedUid(null)}
                      className="relative bg-amber-500 text-white text-[11px] px-2 py-1.5 rounded shadow-sm flex flex-col gap-1 w-full cursor-grab active:cursor-grabbing border border-amber-600"
                    >
                      <div className="flex justify-between items-start w-full">
                        <span className="font-bold leading-tight line-clamp-2" title={line.goodName}>{line.goodName}</span>
                        <button onClick={(e) => handleUnassign(slotIdx, line, e)} className="p-0.5 hover:bg-amber-600 rounded-full shrink-0 ml-1"><X size={10} /></button>
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-amber-100 font-medium bg-amber-600/30 px-1.5 py-0.5 rounded-sm">
                        <span className="flex items-center gap-0.5"><Weight size={10} /> {line.qtyTon.toFixed(2)}t</span>
                        <span className="flex items-center gap-0.5"><Package size={10} /> {line.qtyBag}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-[98vw] max-w-[1400px] h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Truck className="text-blue-600" /> จัดลำดับการโหลดสินค้าบนรถบรรทุก
            </h2>
            <div className="text-sm text-slate-500 mt-1 font-medium">ระบุตำแหน่งสินค้า (คำนึงถึงสมดุลน้ำหนัก)</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSettingsModal(true)} className="gap-2 text-slate-700 border-slate-200 bg-white">
              <Settings size={16} /> ตั้งค่าลิมิต
            </Button>
            <Button variant="outline" onClick={() => setShowStackingGuide(true)} className="gap-2 text-blue-700 border-blue-200 bg-blue-50">
              <Info size={16} /> วิธีการเรียงกระสอบ
            </Button>
            <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600"><X size={24} /></button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0">
          <div 
            className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const uid = e.dataTransfer.getData('uid');
              if (uid) {
                const line = linesWithId.find(l => String(l.uid) === uid);
                if (line) {
                  // find its slot and remove it
                  Object.keys(assigned).forEach(k => {
                    const slotNo = Number(k);
                    if (assigned[slotNo].some(l => String(l.uid) === uid)) {
                      handleUnassign(slotNo, line);
                    }
                  });
                }
              }
            }}
          >
            <div className="p-4 border-b border-slate-200 bg-white shadow-sm z-10">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Package size={18} /> สินค้าที่รอโหลด ({unassigned.length})</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/50">
              <AnimatePresence>
                {unassigned.map(l => (
                  <motion.div
                    layoutId={`line-${l.uid}`}
                    key={l.uid}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('uid', String(l.uid));
                      setDraggedUid(String(l.uid));
                      setSelectedLine(l);
                    }}
                    onDragEnd={() => setDraggedUid(null)}
                    onClick={() => setSelectedLine(selectedLine?.uid === l.uid ? null : l)}
                    className={cn(
                      "p-3 rounded-xl border-2 cursor-grab active:cursor-grabbing transition-all hover:shadow-md",
                      selectedLine?.uid === l.uid ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500/20" : "border-slate-200 bg-white"
                    )}
                  >
                    <div className="font-bold text-slate-800">{l.goodName}</div>
                    <div className="text-xs text-slate-500 font-mono mt-1">{l.goodCode}</div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                      <div className="flex gap-2">
                        <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2 py-1 rounded-lg flex items-center gap-1"><Weight size={12} /> {l.qtyTon.toFixed(2)} ตัน</span>
                        <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-lg flex items-center gap-1"><Package size={12} /> {l.qtyBag} กส.</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex-1 bg-slate-200/50 flex flex-col items-center justify-center p-6 overflow-hidden min-h-0 relative">
            <div className="p-2 flex gap-2 justify-center mb-4 bg-white/80 backdrop-blur rounded-lg shadow-sm border border-slate-200">
              {TRUCK_TYPES.map(t => (
                <button key={t.id} onClick={() => setTruckType(t)} className={cn("px-4 py-1.5 rounded-md text-sm font-bold", truckType.id === t.id ? 'bg-slate-800 text-white' : 'hover:bg-slate-200')}>{t.name}</button>
              ))}
            </div>
            <div className="w-full h-full flex flex-col items-center pt-8 pb-4 overflow-auto">
              <div className="flex flex-col gap-6">
                {/* Truck Row */}
                <div className="flex flex-row items-center">
                  {/* Cabin pointing Left */}
                  <div className="w-[90px] h-32 bg-gradient-to-l from-blue-600 to-blue-800 rounded-l-[2rem] rounded-r-md shadow-lg border-4 border-slate-800 mr-2 shrink-0 z-10 relative overflow-hidden flex items-center justify-start">
                     {/* Window */}
                     <div className="w-10 h-20 bg-slate-900 rounded-l-[1rem] absolute left-2 opacity-60" />
                     {/* Light */}
                     <div className="w-3 h-8 bg-amber-300 absolute left-0 bottom-3 rounded-r-full opacity-80 blur-[1px]" />
                  </div>
                  {/* Bed */}
                  {renderTruckBed(1, truckType.slotCount, truckType.id === 'container' ? 'Container' : 'Bed')}
                </div>
                
                {/* Trailer Row */}
                {truckType.trailerSlotCount && (
                  <div className="flex flex-row items-start pl-[98px] relative">
                    {/* Visual Connector / Hitch */}
                    <div className="absolute -top-6 left-[140px] w-3 h-6 bg-slate-800 z-0 border-x border-slate-600" />
                    {renderTruckBed(truckType.slotCount + 1, truckType.trailerSlotCount, 'Trailer')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between shrink-0">
          <div className="text-sm font-medium text-slate-500">
            {unassigned.length > 0 ? (
              <span className="text-amber-600 flex items-center gap-1"><Package size={16}/> เหลืออีก {unassigned.length} รายการที่ต้องจัดวาง</span>
            ) : (
              <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={16}/> จัดวางครบทุกรายการแล้ว</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onCancel} className="w-32">ยกเลิก</Button>
            <Button 
              onClick={handleConfirm} 
              disabled={unassigned.length > 0}
              className={cn("w-48 gap-2", unassigned.length > 0 ? "bg-slate-300" : "bg-emerald-600 hover:bg-emerald-700 text-white")}
            >
              ยืนยันการโหลด <ArrowRight size={18} />
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Stacking Guide Modal */}
      {showStackingGuide && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" onClick={() => setShowStackingGuide(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2">
                <Info size={20} /> คู่มือการเรียงกระสอบ (Stacking Reference)
              </h3>
              <button onClick={() => setShowStackingGuide(false)} className="text-slate-400 hover:text-slate-600"><X/></button>
            </div>
            <div className="p-6">
              <div className="bg-blue-50 text-blue-800 p-4 rounded-xl mb-4 text-sm font-medium border border-blue-100 leading-relaxed">
                <p>• <b>กระสอบมาตรฐาน:</b> 50 กก. (ขนาดประมาณ 0.5 x 0.8 เมตร)</p>
                <p>• <b>การจัดเรียง (Tie-in Stacking):</b> นิยมเรียงสลับชั้นละ 5 ใบ (ล็อก 3 ใบทางยาว และ 2 ใบทางขวาง) เพื่อป้องกันการโค่นล้มระหว่างขนส่ง</p>
                <p>• <b>รถ 10 ล้อ (15 ตัน):</b> บรรทุกได้ประมาณ 300 กระสอบ</p>
                <p>• <b>รถพ่วง (30 ตัน):</b> บรรทุกได้ประมาณ 600 กระสอบ (แม่ 300 / ลูก 300)</p>
              </div>
              <div className="aspect-video w-full bg-slate-100 rounded-xl overflow-hidden border border-slate-200 relative flex items-center justify-center">
                 <img src={STACKING_GUIDE_IMG} alt="Bag Stacking Guide" className="object-cover w-full h-full" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" onClick={() => setShowSettingsModal(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Settings size={20} /> ตั้งค่าลิมิตน้ำหนักบรรทุก
              </h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-slate-600"><X/></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-500 mb-4">ปรับเปลี่ยนพิกัดการแจ้งเตือนน้ำหนักเกินในแต่ละบล็อคตามมาตรฐานที่ใช้ภายในบริษัทของคุณ (ค่าเริ่มต้นอิงตามกฎหมายกรมทางหลวง)</p>
              
              {TRUCK_TYPES.map(t => {
                const currentLimit = truckPayloadLimits?.[t.id] || t.maxTonPerSlot;
                return (
                  <div key={t.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                    <div>
                      <div className="font-bold text-slate-700">{t.name}</div>
                      <div className="text-xs text-slate-500">ค่าเริ่มต้น: {t.maxTonPerSlot} ตัน / บล็อค</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" 
                        step="0.1" 
                        min="0.1"
                        className="w-20 px-2 py-1 border border-slate-300 rounded text-right"
                        value={currentLimit}
                        onChange={(e) => setTruckPayloadLimit(t.id, Number(e.target.value) || t.maxTonPerSlot)}
                      />
                      <span className="text-sm font-medium text-slate-600">ตัน</span>
                    </div>
                  </div>
                );
              })}
              
              <div className="pt-4 flex justify-end">
                <Button onClick={() => setShowSettingsModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white w-full">บันทึกและปิด</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
