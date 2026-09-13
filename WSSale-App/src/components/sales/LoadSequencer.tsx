import React, { useState, useEffect } from 'react';
import { X, ArrowUp, ArrowDown, GripVertical, CheckCircle2 } from 'lucide-react';
import type { SalesOrder } from '../../types';

export interface SequencedLine {
  memberKind: 'DRAFT' | 'CONFIRMED';
  memberId: string;
  lineNum: number;
  goodId: string;
  goodName: string;
  goodCode: string;
  qtyTon: number;
  masterQty: number;
  childQty: number;
  originalSequence: number | null;
  newSequence: number;
  isGiveaway: boolean;
  custName: string;
  wfRef: string;
}

export function LoadSequencer({
  isOpen,
  onClose,
  tripOrders,
  onConfirm
}: {
  isOpen: boolean;
  onClose: () => void;
  tripOrders: SalesOrder[];
  onConfirm: (sequencedLines: SequencedLine[]) => void;
}) {
  const [lines, setLines] = useState<SequencedLine[]>([]);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && tripOrders) {
      const initialLines: SequencedLine[] = [];
      tripOrders.forEach(order => {
        const kind: 'DRAFT' | 'CONFIRMED' = order.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
        (order.lines || []).forEach((line, idx) => {
          const lineNum = line.lineNum != null ? Number(line.lineNum) : (idx + 1);
          initialLines.push({
            memberKind: kind,
            memberId: String(order.id),
            lineNum,
            goodId: line.goodId,
            goodName: line.goodName || '',
            goodCode: line.goodCode || '',
            qtyTon: line.qtyTon,
            masterQty: line.masterQty ?? line.qtyTon,
            childQty: line.childQty ?? 0,
            originalSequence: line.loadSequence ? Number(line.loadSequence) : null,
            newSequence: 0,
            isGiveaway: !!line.isGiveaway,
            custName: order.custName || '',
            wfRef: order.wfRef || ''
          });
        });
      });
      
      // Sort by existing sequence if available
      initialLines.sort((a, b) => {
        if (a.originalSequence && b.originalSequence) return a.originalSequence - b.originalSequence;
        if (a.originalSequence) return -1;
        if (b.originalSequence) return 1;
        return 0;
      });

      // Assign new 1-based sequence
      initialLines.forEach((l, i) => l.newSequence = i + 1);
      setLines(initialLines);
    }
  }, [isOpen, tripOrders]);

  if (!isOpen) return null;

  const moveLine = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index > 0) {
      const newLines = [...lines];
      const temp = newLines[index];
      newLines[index] = newLines[index - 1];
      newLines[index - 1] = temp;
      newLines.forEach((l, i) => l.newSequence = i + 1);
      setLines(newLines);
    } else if (direction === 'down' && index < lines.length - 1) {
      const newLines = [...lines];
      const temp = newLines[index];
      newLines[index] = newLines[index + 1];
      newLines[index + 1] = temp;
      newLines.forEach((l, i) => l.newSequence = i + 1);
      setLines(newLines);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-[#0C447C] text-white rounded-t-xl shrink-0">
          <div>
            <h2 className="font-bold text-lg">จัดลำดับการขึ้นของ (Load Sequence)</h2>
            <p className="text-xs text-blue-200">ลำดับที่ 1 จะขึ้นของก่อน (อยู่ด้านในสุดของรถ)</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 bg-gray-50">
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div 
                key={`${line.memberKind}-${line.memberId}-${line.lineNum}`}
                draggable
                onDragStart={(e) => {
                  setDraggedIdx(idx);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedIdx === null || draggedIdx === idx) return;
                  const newLines = [...lines];
                  const item = newLines.splice(draggedIdx, 1)[0];
                  newLines.splice(idx, 0, item);
                  newLines.forEach((l, i) => l.newSequence = i + 1);
                  setLines(newLines);
                  setDraggedIdx(null);
                }}
                className={`bg-white border rounded-lg p-3 flex items-center gap-3 shadow-sm transition-colors ${draggedIdx === idx ? 'border-[#0C447C] bg-blue-50 opacity-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <button onClick={() => moveLine(idx, 'up')} disabled={idx === 0} className="p-1 text-gray-400 hover:text-[#0C447C] disabled:opacity-30"><ArrowUp size={14}/></button>
                  <button onClick={() => moveLine(idx, 'down')} disabled={idx === lines.length - 1} className="p-1 text-gray-400 hover:text-[#0C447C] disabled:opacity-30"><ArrowDown size={14}/></button>
                </div>
                
                <div className="cursor-grab active:cursor-grabbing text-gray-400 p-1 shrink-0">
                  <GripVertical size={16} />
                </div>
                
                <div className="w-8 h-8 rounded-full bg-blue-100 text-[#0C447C] font-bold flex items-center justify-center shrink-0">
                  {line.newSequence}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between">
                    <div className="font-bold text-gray-800 text-sm truncate" title={line.goodName}>{line.goodName}</div>
                    <div className="font-bold text-[#0C447C] text-sm shrink-0 pl-2">{line.qtyTon.toLocaleString()} t</div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex justify-between">
                    <span>บิล: {line.wfRef} • ลค: {line.custName}</span>
                    <span className="flex gap-2">
                      <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">แม่: {line.masterQty}t</span>
                      <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">ลูก: {line.childQty}t</span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 bg-white flex justify-end gap-3 shrink-0 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg">ยกเลิก</button>
          <button 
            onClick={() => onConfirm(lines)}
            className="px-4 py-2 text-sm font-bold text-white bg-[#0C447C] hover:bg-blue-800 rounded-lg flex items-center gap-2"
          >
            <CheckCircle2 size={16} /> ยืนยันลำดับ
          </button>
        </div>
      </div>
    </div>
  );
}
