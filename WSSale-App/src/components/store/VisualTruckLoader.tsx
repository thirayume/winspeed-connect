import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Truck, X, ArrowRight, CheckCircle2, Package, Info, Weight, Settings } from 'lucide-react';
import { Button, cn } from '../ui/Base';
import type { SalesOrder, SalesOrderLine, TruckType } from '../../types';
import { predictTruckCategory } from '../../utils/truckAnalyzer';
import { fetchTruckTypes } from '../../services/api';

const STACKING_GUIDE_IMG = "/bag_stacking_guide_1782372817658.png";

const ITEM_COLORS = [
  { bg: 'bg-amber-500', border: 'border-amber-600', text: 'text-white', mute: 'bg-amber-600/30 text-amber-100', hover: 'hover:bg-amber-600', icon: 'text-amber-100' },
  { bg: 'bg-emerald-500', border: 'border-emerald-600', text: 'text-white', mute: 'bg-emerald-600/30 text-emerald-100', hover: 'hover:bg-emerald-600', icon: 'text-emerald-100' },
  { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-white', mute: 'bg-blue-600/30 text-blue-100', hover: 'hover:bg-blue-600', icon: 'text-blue-100' },
  { bg: 'bg-violet-500', border: 'border-violet-600', text: 'text-white', mute: 'bg-violet-600/30 text-violet-100', hover: 'hover:bg-violet-600', icon: 'text-violet-100' },
  { bg: 'bg-rose-500', border: 'border-rose-600', text: 'text-white', mute: 'bg-rose-600/30 text-rose-100', hover: 'hover:bg-rose-600', icon: 'text-rose-100' },
  { bg: 'bg-cyan-600', border: 'border-cyan-700', text: 'text-white', mute: 'bg-cyan-700/30 text-cyan-100', hover: 'hover:bg-cyan-700', icon: 'text-cyan-100' },
];

const getColorForProduct = (goodCode: string) => {
  let hash = 0;
  for (let i = 0; i < goodCode.length; i++) {
    hash = goodCode.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ITEM_COLORS[Math.abs(hash) % ITEM_COLORS.length];
};



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

  const [truckTypesList, setTruckTypesList] = useState<TruckType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  
  const [truckType, setTruckType] = useState<TruckType | null>(null);
  
  useEffect(() => {
    fetchTruckTypes().then(types => {
      const activeTypes = types.filter(t => t.IsActive !== false);
      setTruckTypesList(activeTypes);
      const category = predictTruckCategory(order.truckPlate);
      const found = activeTypes.find(t => t.Id === category);
      // Fallback to '10w' or the first available
      setTruckType(found || activeTypes.find(t => t.Id === '10w') || activeTypes[0] || null);
      setLoadingTypes(false);
    }).catch(e => {
      console.error(e);
      setLoadingTypes(false);
    });
  }, [order.truckPlate]);

  const currentMaxTonPerSlot = truckType ? truckType.MaxTonPerSlot : 0;

  const [unassigned, setUnassigned] = useState<typeof linesWithId>([]);
  const [assigned, setAssigned] = useState<Record<number, typeof linesWithId>>({});
  const [selectedLine, setSelectedLine] = useState<typeof linesWithId[0] | null>(null);
  const [showStackingGuide, setShowStackingGuide] = useState(false);
  const [draggedUid, setDraggedUid] = useState<string | null>(null);

  // Auto-assignment
  useEffect(() => {
    if (!truckType) return;
    
    let currentSlot = 1;
    const initialAssigned: Record<number, typeof linesWithId> = {};
    const initialUnassigned: typeof linesWithId = [];
    const maxSlots = truckType.SlotCount + (truckType.TrailerSlotCount || 0);

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
  }, [linesWithId, truckType, currentMaxTonPerSlot]);

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
                
                {/* Visual cue for tap-to-place */}
                {selectedLine && !draggedUid && (
                   <div className="absolute inset-0 border-2 border-dashed border-blue-500 bg-blue-50/60 z-20 flex items-center justify-center rounded-lg pointer-events-none transition-all">
                     <span className="bg-blue-600 text-white text-[10px] sm:text-xs font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-full animate-bounce shadow-md">แตะเพื่อวาง</span>
                   </div>
                )}
                
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
                  {lines.map(line => {
                    const color = getColorForProduct(line.goodCode || line.uid);
                    return (
                    <motion.div 
                      layoutId={`line-${line.uid}`}
                      key={line.uid} 
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('uid', String(line.uid));
                        setDraggedUid(String(line.uid));
                      }}
                      onDragEnd={() => setDraggedUid(null)}
                      className={cn("relative text-[11px] px-2 py-1.5 rounded shadow-sm flex flex-col gap-1 w-full cursor-grab active:cursor-grabbing border", color.bg, color.text, color.border)}
                    >
                      <div className="flex justify-between items-start w-full">
                        <span className="font-bold leading-tight line-clamp-2" title={line.goodName}>{line.goodName}</span>
                        <button onClick={(e) => handleUnassign(slotIdx, line, e)} className={cn("p-0.5 rounded-full shrink-0 ml-1 transition-colors", color.hover)}><X size={10} /></button>
                      </div>
                      <div className={cn("flex items-center justify-between text-[9px] font-medium px-1.5 py-0.5 rounded-sm", color.mute)}>
                        <span className="flex items-center gap-0.5"><Weight size={10} className={color.icon} /> {line.qtyTon.toFixed(2)}t</span>
                        <span className="flex items-center gap-0.5"><Package size={10} className={color.icon} /> {line.qtyBag}</span>
                      </div>
                    </motion.div>
                  )})}
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
        <div className="p-3 sm:p-4 border-b border-slate-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0 relative">
          <div className="pr-16">
            <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-2">
              <Truck className="text-blue-600 shrink-0" /> จัดลำดับการโหลดสินค้า
            </h2>
            <div className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">ระบุตำแหน่งสินค้า (คำนึงถึงสมดุลน้ำหนัก)</div>
          </div>
          <div className="absolute top-2 sm:top-3 right-2 sm:right-3 flex items-center gap-1">
            <button 
              onClick={() => setShowStackingGuide(true)} 
              className="p-2 hover:bg-blue-50 rounded-full text-blue-500 hover:text-blue-700 transition-colors"
              title="วิธีการเรียงกระสอบ"
            >
              <Info size={20} />
            </button>
            <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
          <div 
            className="w-full lg:w-80 lg:h-full h-[40%] lg:border-r border-b lg:border-b-0 border-slate-200 bg-white flex flex-col shrink-0"
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
            <div className="flex-1 overflow-y-auto p-2 sm:p-4 grid grid-cols-2 gap-2 content-start bg-slate-50/50">
              <AnimatePresence>
                {unassigned.map(l => {
                  const color = getColorForProduct(l.goodCode || l.uid);
                  const isSelected = selectedLine?.uid === l.uid;
                  return (
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
                    onClick={() => setSelectedLine(isSelected ? null : l)}
                    className={cn(
                      "px-2 py-1.5 rounded-lg border-2 cursor-grab active:cursor-grabbing transition-all flex flex-col justify-between shadow-sm",
                      isSelected ? cn("ring-2 ring-blue-500/30 ring-offset-1", color.border, color.bg, color.text) : cn("border-slate-200 bg-white hover:border-slate-300")
                    )}
                  >
                    <div>
                      <div className={cn("font-bold text-xs sm:text-sm leading-tight line-clamp-2", isSelected ? color.text : "text-slate-800")}>{l.goodName}</div>
                      <div className={cn("text-[9px] sm:text-[10px] font-mono mt-0.5", isSelected ? color.icon : "text-slate-400")}>{l.goodCode}</div>
                    </div>
                    <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100/50">
                        <span className={cn("text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5", isSelected ? color.mute : "bg-blue-50 text-blue-700")}><Weight size={10} /> {l.qtyTon.toFixed(2)}t</span>
                        <span className={cn("text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5", isSelected ? color.mute : "bg-amber-50 text-amber-700")}><Package size={10} /> {l.qtyBag}</span>
                    </div>
                  </motion.div>
                )})}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex-1 bg-slate-200/50 flex flex-col items-center justify-start lg:justify-center p-3 sm:p-6 overflow-hidden min-h-0 relative">
            
            {/* Desktop Truck Selector */}
            <div className="hidden sm:flex p-1.5 flex-nowrap sm:flex-wrap gap-1 sm:gap-2 justify-start sm:justify-center mb-4 bg-white/80 backdrop-blur rounded-lg shadow-sm border border-slate-200 w-full lg:w-auto shrink-0">
              {truckTypesList.map(t => (
                <button key={t.Id} onClick={() => setTruckType(t)} className={cn("px-3 py-1.5 rounded-md text-xs sm:text-sm font-bold whitespace-nowrap", truckType?.Id === t.Id ? 'bg-slate-800 text-white' : 'hover:bg-slate-200')}>{t.Name}</button>
              ))}
            </div>
            
            {/* Mobile Truck Selector */}
            <div className="sm:hidden w-full max-w-[400px] mb-4 shrink-0">
              <select 
                value={truckType?.Id || ''}
                onChange={e => {
                  const t = truckTypesList.find(x => x.Id === e.target.value);
                  if (t) setTruckType(t);
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white shadow-sm text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2224%22%20height%3D%2224%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23475569%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1.25em_1.25em] bg-[right_0.5rem_center] bg-no-repeat pr-10"
              >
                {truckTypesList.map(t => (
                  <option key={t.Id} value={t.Id}>{t.Name}</option>
                ))}
              </select>
            </div>

            <div className="w-full h-full flex flex-col items-start lg:items-center pt-2 sm:pt-8 pb-4 overflow-auto">
              {loadingTypes || !truckType ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400 mb-4"></div>
                  กำลังโหลดข้อมูล...
                </div>
              ) : (
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
                    {renderTruckBed(1, truckType.SlotCount, truckType.Id === 'container' ? 'Container' : (truckType.Id === 'semi-trailer' ? 'Flatbed Trailer' : 'Bed'))}
                  </div>
                  
                  {/* Trailer Row */}
                  {truckType.TrailerSlotCount != null && truckType.TrailerSlotCount > 0 && (
                    <div className="flex flex-row items-start pl-[98px] relative">
                      {/* Visual Connector / Hitch */}
                      <div className="absolute -top-6 left-[140px] w-3 h-6 bg-slate-800 z-0 border-x border-slate-600" />
                      {renderTruckBed(truckType.SlotCount + 1, truckType.TrailerSlotCount, 'Trailer')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between shrink-0 gap-3">
          <div className="text-xs sm:text-sm font-medium text-slate-500 text-center sm:text-left">
            {unassigned.length > 0 ? (
              <span className="text-amber-600 flex items-center justify-center sm:justify-start gap-1"><Package size={16}/> เหลืออีก {unassigned.length} รายการที่ต้องจัดวาง</span>
            ) : (
              <span className="text-emerald-600 flex items-center justify-center sm:justify-start gap-1"><CheckCircle2 size={16}/> จัดวางครบทุกรายการแล้ว</span>
            )}
          </div>
          <div className="flex gap-2 sm:gap-3 w-full sm:w-auto">
            <Button variant="outline" onClick={onCancel} className="flex-1 sm:w-32 py-2 sm:py-1">ยกเลิก</Button>
            <Button 
              onClick={handleConfirm} 
              disabled={unassigned.length > 0}
              className={cn("flex-1 sm:w-48 gap-2 py-2 sm:py-1", unassigned.length > 0 ? "bg-slate-300" : "bg-emerald-600 hover:bg-emerald-700 text-white")}
            >
              ยืนยัน <ArrowRight size={18} className="hidden sm:block" />
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
    </div>
  );
};
