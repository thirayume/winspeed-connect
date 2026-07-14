import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Truck, X, ArrowRight, CheckCircle2, Package, Info, Weight } from 'lucide-react';
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
  for (let i = 0; i < goodCode.length; i++) hash = goodCode.charCodeAt(i) + ((hash << 5) - hash);
  return ITEM_COLORS[Math.abs(hash) % ITEM_COLORS.length];
};

export const VisualTruckLoader = ({ 
  order, onConfirm, onCancel 
}: { 
  order: SalesOrder; onConfirm: (sequences: Record<number, number>) => void; onCancel: () => void;
}) => {
  const linesWithId = useMemo(() => {
    return (order.lines || []).filter(l => !l.isGiveaway).map((l, idx) => ({
      ...l, uid: l.lineNum || l.id || `fallback-${idx}`
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
      setTruckType(found || activeTypes.find(t => t.Id === '10w') || activeTypes[0] || null);
      setLoadingTypes(false);
    }).catch(e => { console.error(e); setLoadingTypes(false); });
  }, [order.truckPlate]);

  const [unassigned, setUnassigned] = useState<typeof linesWithId>([]);
  const [assigned, setAssigned] = useState<{main: typeof linesWithId, trailer: typeof linesWithId}>({ main: [], trailer: [] });
  const [selectedLine, setSelectedLine] = useState<typeof linesWithId[0] | null>(null);
  const [showStackingGuide, setShowStackingGuide] = useState(false);
  const [draggedUid, setDraggedUid] = useState<string | null>(null);

  useEffect(() => {
    if (!truckType) return;
    const initialMain: typeof linesWithId = [];
    const initialTrailer: typeof linesWithId = [];
    const initialUnassigned: typeof linesWithId = [];

    const hasTrailer = (truckType.MaxWeightTrailer || 0) > 0;
    const maxMain = truckType.MaxWeightMain || 15;

    const withSeq = linesWithId.filter(l => l.loadSequence && l.loadSequence > 0);
    const withoutSeq = linesWithId.filter(l => !l.loadSequence || l.loadSequence === 0);

    withSeq.forEach(l => {
       if (l.loadSequence! >= 100 && l.loadSequence! < 200) initialMain.push(l);
       else if (l.loadSequence! >= 200) initialTrailer.push(l);
    });
    initialMain.sort((a,b) => (a.loadSequence || 0) - (b.loadSequence || 0));
    initialTrailer.sort((a,b) => (a.loadSequence || 0) - (b.loadSequence || 0));

    withoutSeq.forEach(l => {
       const currentMainWeight = initialMain.reduce((sum, item) => sum + item.qtyTon, 0);
       if (currentMainWeight + l.qtyTon <= maxMain || !hasTrailer) {
          initialMain.push(l);
       } else {
          initialTrailer.push(l);
       }
    });

    setAssigned({ main: initialMain, trailer: initialTrailer });
    setUnassigned(initialUnassigned);
    setSelectedLine(null);
  }, [linesWithId, truckType]);

  const handleUnassign = (line: typeof linesWithId[0], e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAssigned(prev => ({
      main: prev.main.filter(l => l.uid !== line.uid),
      trailer: prev.trailer.filter(l => l.uid !== line.uid)
    }));
    setUnassigned(prev => prev.some(l => l.uid === line.uid) ? prev : [...prev, line]);
  };

  const handleDropToZone = (zone: 'main'|'trailer', uid: string, targetIdx?: number) => {
    const line = linesWithId.find(l => String(l.uid) === uid);
    if (!line) return;

    setUnassigned(prev => prev.filter(l => String(l.uid) !== uid));
    setAssigned(prev => {
      const next = { 
         main: prev.main.filter(l => String(l.uid) !== uid),
         trailer: prev.trailer.filter(l => String(l.uid) !== uid)
      };
      
      if (targetIdx !== undefined) {
         next[zone].splice(targetIdx, 0, line);
      } else {
         next[zone].push(line);
      }
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
    
    assigned.main.forEach((l, idx) => {
      if (l.lineNum) seqMapping[l.lineNum] = idx + 101; // 101 to 199
    });
    assigned.trailer.forEach((l, idx) => {
      if (l.lineNum) seqMapping[l.lineNum] = idx + 201; // 201 to 299
    });
    
    onConfirm(seqMapping);
  };

  const renderBed = (zone: 'main'|'trailer', label: string, maxWeight: number) => {
    const lines = assigned[zone];
    const totalWeight = lines.reduce((acc, curr) => acc + curr.qtyTon, 0);
    const isOverloaded = totalWeight > maxWeight;

    return (
      <div 
         className={cn(
           "flex flex-col border-[3px] rounded-lg shadow-inner overflow-hidden shrink-0 w-[260px] sm:w-[280px] transition-all",
           isOverloaded ? "border-red-400 bg-red-50/30" : "border-slate-700 bg-slate-50",
           draggedUid && "ring-2 ring-blue-400"
         )}
         onDragOver={e => e.preventDefault()}
         onDrop={e => {
            e.preventDefault();
            const uid = e.dataTransfer.getData('uid');
            if (uid) handleDropToZone(zone, uid);
         }}
      >
        <div className={cn("text-white text-center text-[10px] sm:text-xs uppercase tracking-widest py-1.5 font-bold flex justify-between px-3", isOverloaded ? "bg-red-600" : "bg-slate-700")}>
           <span>{label}</span>
           <span>{totalWeight.toFixed(2)} / {maxWeight.toFixed(1)}t {isOverloaded && '⚠️'}</span>
        </div>
        <div className="flex flex-col gap-2 p-2 min-h-[320px] overflow-y-auto">
           {lines.length === 0 && (
             <div className="flex-1 flex items-center justify-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg">
                ลากสินค้ามาวางที่นี่
             </div>
           )}
           <AnimatePresence>
           {lines.map((line, idx) => {
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
                 onDragOver={e => {
                    e.preventDefault();
                    e.stopPropagation();
                 }}
                 onDrop={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const uid = e.dataTransfer.getData('uid');
                    if (uid && uid !== String(line.uid)) {
                       handleDropToZone(zone, uid, idx);
                    }
                 }}
                 className={cn("relative text-xs px-2 py-2 rounded shadow-sm flex flex-col gap-1 w-full cursor-grab active:cursor-grabbing border", color.bg, color.text, color.border)}
               >
                 <div className="absolute -left-2 -top-2 bg-slate-800 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-md">{idx + 1}</div>
                 <div className="flex justify-between items-start w-full pl-2">
                   <span className="font-bold leading-tight line-clamp-2" title={line.goodName}>{line.goodName}</span>
                   <button onClick={(e) => handleUnassign(line, e)} className={cn("p-1 rounded-full shrink-0 ml-1 transition-colors", color.hover)}><X size={12} /></button>
                 </div>
                 <div className={cn("flex items-center justify-between text-[10px] font-medium px-2 py-1 rounded-sm mt-1", color.mute)}>
                   <span className="flex items-center gap-1"><Weight size={12} className={color.icon} /> {line.qtyTon.toFixed(2)}t</span>
                   <span className="flex items-center gap-1"><Package size={12} className={color.icon} /> {line.qtyBag}</span>
                 </div>
               </motion.div>
             )
           })}
           </AnimatePresence>
           {selectedLine && !draggedUid && (
              <button 
                 onClick={() => { handleDropToZone(zone, String(selectedLine.uid)); }}
                 className="w-full py-3 border-2 border-dashed border-blue-400 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-700 font-bold text-sm transition-colors flex items-center justify-center gap-2"
              >
                 วาง <b>{selectedLine.goodName}</b> ที่นี่
              </button>
           )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-[98vw] max-w-[1200px] h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-slate-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0 relative">
          <div className="pr-16">
            <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-2">
              <Truck className="text-blue-600 shrink-0" /> จัดลำดับการโหลดสินค้า
            </h2>
            <div className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">จัดเรียงสินค้าจากหัวไปท้าย (เรียงจากบนลงล่าง)</div>
          </div>
          <div className="absolute top-2 sm:top-3 right-2 sm:right-3 flex items-center gap-1">
            <button onClick={() => setShowStackingGuide(true)} className="p-2 hover:bg-blue-50 rounded-full text-blue-500 hover:text-blue-700 transition-colors" title="วิธีการเรียงกระสอบ"><Info size={20} /></button>
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
                if (line) handleUnassign(line);
              }
            }}
          >
            <div className="p-4 border-b border-slate-200 bg-white shadow-sm z-10 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Package size={18} /> สินค้าที่รอโหลด ({unassigned.length})</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 sm:p-4 grid grid-cols-2 lg:grid-cols-1 gap-2 content-start bg-slate-50/50">
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
                      "px-3 py-2 rounded-lg border-2 cursor-grab active:cursor-grabbing transition-all flex flex-col justify-between shadow-sm",
                      isSelected ? cn("ring-2 ring-blue-500/30 ring-offset-1", color.border, color.bg, color.text) : cn("border-slate-200 bg-white hover:border-slate-300")
                    )}
                  >
                    <div>
                      <div className={cn("font-bold text-xs sm:text-sm leading-tight line-clamp-2", isSelected ? color.text : "text-slate-800")}>{l.goodName}</div>
                      <div className={cn("text-[10px] font-mono mt-1", isSelected ? color.icon : "text-slate-400")}>{l.goodCode}</div>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100/50">
                        <span className={cn("text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1", isSelected ? color.mute : "bg-blue-50 text-blue-700")}><Weight size={12} /> {l.qtyTon.toFixed(2)}t</span>
                        <span className={cn("text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1", isSelected ? color.mute : "bg-amber-50 text-amber-700")}><Package size={12} /> {l.qtyBag}</span>
                    </div>
                  </motion.div>
                )})}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex-1 bg-slate-200/50 flex flex-col items-center justify-start p-3 sm:p-6 overflow-hidden min-h-0 relative">
            <div className="w-full flex justify-center mb-4 shrink-0">
               <select 
                 value={truckType?.Id || ''}
                 onChange={e => {
                   const t = truckTypesList.find(x => x.Id === e.target.value);
                   if (t) setTruckType(t);
                 }}
                 className="w-full max-w-xs px-4 py-2.5 rounded-lg border border-slate-300 bg-white shadow-sm text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2224%22%20height%3D%2224%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23475569%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1.25em_1.25em] bg-[right_0.5rem_center] bg-no-repeat pr-10"
               >
                 {truckTypesList.map(t => (
                   <option key={t.Id} value={t.Id}>{t.Name}</option>
                 ))}
               </select>
            </div>

            <div className="w-full h-full flex flex-col items-center justify-start pt-2 overflow-auto pb-8">
              {loadingTypes || !truckType ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400 mb-4"></div>กำลังโหลดข้อมูล...
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-stretch justify-center gap-6">
                  {/* Main Bed */}
                  <div className="flex flex-col items-center">
                    <div className="w-[90px] h-20 bg-gradient-to-t from-blue-600 to-blue-800 rounded-t-3xl rounded-b-md shadow-lg border-4 border-slate-800 mb-2 shrink-0 z-10 relative overflow-hidden flex items-start justify-center">
                       <div className="w-16 h-8 bg-slate-900 rounded-t-xl absolute top-2 opacity-60" />
                    </div>
                    {renderBed('main', truckType.Id === 'container' ? 'Container' : 'ตัวแม่ (Main)', truckType.MaxWeightMain || 15)}
                  </div>
                  
                  {/* Trailer Bed */}
                  {(truckType.MaxWeightTrailer || 0) > 0 && (
                    <div className="flex flex-col items-center relative mt-16 sm:mt-0">
                      <div className="hidden sm:block absolute -left-6 top-32 w-6 h-3 bg-slate-800 z-0 border-y border-slate-600" />
                      <div className="sm:hidden absolute -top-8 left-1/2 -ml-1.5 h-8 w-3 bg-slate-800 z-0 border-x border-slate-600" />
                      <div className="w-[90px] h-10 bg-slate-600 rounded-md shadow-lg border-4 border-slate-800 mb-2 shrink-0 z-10 relative flex items-center justify-center text-[10px] text-white font-bold">HITCH</div>
                      {renderBed('trailer', 'ตัวลูก (Trailer)', truckType.MaxWeightTrailer || 15)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-3 sm:p-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between shrink-0 gap-3">
          <div className="text-xs sm:text-sm font-medium text-slate-500">
            {unassigned.length > 0 ? (
              <span className="text-amber-600 flex items-center justify-center gap-1"><Package size={16}/> เหลืออีก {unassigned.length} รายการที่ต้องจัดวาง</span>
            ) : (
              <span className="text-emerald-600 flex items-center justify-center gap-1"><CheckCircle2 size={16}/> จัดวางครบทุกรายการแล้ว</span>
            )}
          </div>
          <div className="flex gap-2 sm:gap-3 w-full sm:w-auto">
            <Button variant="outline" onClick={onCancel} className="flex-1 sm:w-32 py-2">ยกเลิก</Button>
            <Button onClick={handleConfirm} disabled={unassigned.length > 0} className={cn("flex-1 sm:w-48 gap-2 py-2", unassigned.length > 0 ? "bg-slate-300" : "bg-emerald-600 hover:bg-emerald-700 text-white")}>
              ยืนยัน <ArrowRight size={18} className="hidden sm:block" />
            </Button>
          </div>
        </div>
      </motion.div>
      {showStackingGuide && (
         <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" onClick={() => setShowStackingGuide(false)}>
            <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl p-6" onClick={e=>e.stopPropagation()}>
               <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold">คู่มือการเรียงกระสอบ</h3>
                  <button onClick={() => setShowStackingGuide(false)}><X/></button>
               </div>
               <img src={STACKING_GUIDE_IMG} className="w-full rounded-lg border" />
            </div>
         </div>
      )}
    </div>
  );
};
