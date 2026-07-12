import React, { useState, useEffect, useCallback } from 'react';
import { X, Check, Unlock, RefreshCw, Eye } from 'lucide-react';
import { listUnlockRequests, resolveUnlockReq, fetchSalesOrder } from '../../services/api';
import type { UnlockReq, SalesOrder } from '../../types';
import { SODetailsPanel } from '../sales/SODetailsPanel';

export function UnlockReviewModal({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [reqs, setReqs] = useState<UnlockReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [actionState, setActionState] = useState<{ id: number; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  
  const [viewSo, setViewSo] = useState<SalesOrder | null>(null);
  const [loadingSoId, setLoadingSoId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setReqs(await listUnlockRequests('PENDING')); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function submitResolve(r: UnlockReq, approve: boolean) {
    if (!approve && !note.trim()) {
      alert('กรุณาระบุเหตุผลที่ปฏิเสธ');
      return;
    }
    setBusyId(r.Id);
    try { 
      await resolveUnlockReq(r.Id, approve, note.trim()); 
      setActionState(null);
      setNote('');
      await reload(); 
      onDone?.(); 
    } catch (e) { 
      alert((e as Error).message); 
    } finally { 
      setBusyId(null); 
    }
  }

  async function openDetails(soId: number) {
    setLoadingSoId(soId);
    try {
      const so = await fetchSalesOrder(soId);
      setViewSo(so);
    } catch (e) {
      alert('ไม่สามารถโหลดรายละเอียดเอกสารได้');
    } finally {
      setLoadingSoId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Unlock size={18} className="text-amber-600" /> คำขอปลดล็อก (รออนุมัติ)
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-0 sm:p-5 space-y-2 sm:space-y-3">
          {loading ? (
            <div className="py-10 flex justify-center">
              <RefreshCw size={22} className="animate-spin text-gray-300" />
            </div>
          ) : reqs.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">ไม่มีคำขอที่รออนุมัติ</p>
          ) : reqs.map(r => {
            const reqTypeStr = r.ReqType === 'EDIT' ? 'ขอแก้ไขเอกสาร' : r.ReqType === 'CANCEL' ? 'ขอยกเลิกเอกสาร' : 'ขอปลดล็อก';
            const badgeColor = r.ReqType === 'EDIT' ? 'bg-[#0C447C] text-white' : r.ReqType === 'CANCEL' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800';
            const isActionActive = actionState?.id === r.Id;

            return (
              <div key={r.Id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${badgeColor}`}>{reqTypeStr}</span>
                    <button 
                      onClick={() => openDetails(r.SoId)}
                      disabled={loadingSoId === r.SoId}
                      className="group flex items-center gap-1 hover:bg-blue-50 px-1.5 py-0.5 rounded transition-colors"
                    >
                      <span className="font-mono font-bold text-sm text-[#0C447C] group-hover:underline cursor-pointer">{r.WfRef || r.SoId}</span>
                      {loadingSoId === r.SoId ? <RefreshCw size={12} className="animate-spin text-blue-400" /> : <Eye size={14} className="text-blue-400 group-hover:text-blue-600" />}
                    </button>
                  </div>
                  <span className="text-[11px] text-gray-400">{new Date(r.RequestedAt).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="text-xs text-gray-600 mb-1">เหตุผล: {r.Reason}</div>
                <div className="text-[11px] text-gray-400 mb-2">โดย: {r.RequesterName || '-'}</div>
                
                {isActionActive ? (
                  <div className="mt-3 pt-3 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 duration-200">
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      {actionState.approve ? 'หมายเหตุ (ถ้ามี)' : 'เหตุผลที่ปฏิเสธ (จำเป็น)'}
                    </label>
                    <input
                      type="text"
                      autoFocus
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                      placeholder={actionState.approve ? 'กรอกหมายเหตุ...' : 'ระบุเหตุผล...'}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') submitResolve(r, actionState.approve);
                        if (e.key === 'Escape') setActionState(null);
                      }}
                    />
                    <div className="flex gap-2">
                      <button 
                        disabled={busyId === r.Id || (!actionState.approve && !note.trim())}
                        onClick={() => submitResolve(r, actionState.approve)}
                        className={`flex-1 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1 ${actionState.approve ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
                      >
                        ยืนยัน{actionState.approve ? 'อนุมัติ' : 'ปฏิเสธ'}
                      </button>
                      <button 
                        disabled={busyId === r.Id}
                        onClick={() => {
                          setActionState(null);
                          setNote('');
                        }}
                        className="flex-1 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-2">
                    <button disabled={busyId === r.Id} onClick={() => {
                      setActionState({ id: r.Id, approve: true });
                      setNote('');
                    }}
                      className="flex-1 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-1">
                      <Check size={13} /> อนุมัติ
                    </button>
                    <button disabled={busyId === r.Id} onClick={() => {
                      setActionState({ id: r.Id, approve: false });
                      setNote('');
                    }}
                      className="flex-1 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50">
                      ไม่อนุมัติ
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      
      {viewSo && (
        <SODetailsPanel so={viewSo} onClose={() => setViewSo(null)} onUpdate={() => {}} isInline={false} />
      )}
    </div>
  );
}
