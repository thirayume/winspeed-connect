import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Unlock } from 'lucide-react';
import { Button } from '../ui/Base';
import { SOStatusBadge } from './SOStatusBadge';
import { useErpStore } from '../../store/erp-store';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { UnlockModal } from './UnlockModal';
import { updateSOStatus, requestUnlock, deleteSO } from '../../services/api';
import type { SOWithDetails } from '../../types';

export function SODetailsPanel({
  so,
  isOpen,
  onClose,
  onUpdate,
  onEdit,
}: {
  so: SOWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onEdit?: (so: SOWithDetails) => void;
}) {
  const customers = useErpStore((s) => s.customers);
  const requests = useErpStore((s) => s.unlockRequests);
  const [busy, setBusy] = useState(false);
  const [showConfirmAction, setShowConfirmAction] = useState(false);
  const [showCancelAction, setShowCancelAction] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  if (!so) return null;

  const customer = customers.find((c) => c.CustID === so.CustID);
  const total = so.TotalAmt ?? so.lines.reduce((sum, l) => sum + l.GoodQty1 * l.GoodPrice1, 0);
  const locked = so.Status !== 'Draft';
  const pendingReq = requests.find((r) => r.SOID === so.SOID && !r.resolved);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await updateSOStatus(so.SOID, 'Confirmed');
      onUpdate();
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to confirm order');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await deleteSO(so.SOID);
      onUpdate();
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to cancel order');
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = () => {
    if (so && onEdit) {
      onEdit(so);
      onClose();
    }
  };

  const handleUnlock = async (reason: string) => {
    setBusy(true);
    try {
      await requestUnlock(so.SOID, reason);
      onUpdate();
    } catch (err) {
      console.error(err);
      alert("Failed to send unlock request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white shadow-2xl sm:border-l border-border flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-5">
              <div className="flex flex-col">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold text-foreground">{so.SOID}</h2>
                  <SOStatusBadge status={so.Status} />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {so.DocuNo && `${so.DocuNo} · `}{so.CustName || customer?.CustName} · {so.DocuDate}
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-muted-foreground hover:bg-slate-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-6 p-6">
              {locked && (
                <div className="flex items-start gap-3 rounded-lg border border-[var(--color-status-locked)]/30 bg-[var(--color-status-locked)]/5 p-4 text-sm">
                  <Lock className="mt-0.5 h-4 w-4 text-[var(--color-status-locked)] shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">This SO is locked</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Editing and cancellation are disabled while warehouse is processing.
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Line Items
                </h3>
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/50 text-xs font-medium text-muted-foreground border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left">Item</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {so.lines.map((l) => {
                        return (
                          <tr key={l.ListNo} className="tabular">
                            <td className="px-4 py-3">
                              <div className="font-medium text-foreground">
                                {l.GoodName || l.GoodID}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {l.GoodID} · ฿{l.GoodPrice1.toLocaleString()}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">
                              {l.GoodQty1}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-foreground">
                              ฿{(l.GoodQty1 * l.GoodPrice1).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-6">
                <span className="text-sm font-medium text-muted-foreground">Order total</span>
                <span className="text-2xl font-bold tabular text-foreground">
                  ฿{total.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="border-t border-border bg-slate-50/50 p-6 space-y-3 pb-12 sm:pb-6">
              {so.Status === 'Draft' && (
                <Button className="w-full" onClick={() => setShowConfirmAction(true)} disabled={busy}>
                  Confirm Order
                </Button>
              )}
              {(so.Status === 'Confirmed' || so.Status === 'Picking') &&
                (pendingReq ? (
                  <Button variant="secondary" className="w-full" disabled>
                    Unlock requested · Awaiting Store
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full bg-[var(--color-status-locked)] hover:bg-[var(--color-status-locked)]/90"
                    onClick={() => setShowUnlockModal(true)}
                    disabled={busy}
                  >
                    <Unlock className="mr-2 h-4 w-4" /> Request Unlock
                  </Button>
                ))}
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" disabled={locked || busy} onClick={handleEdit}>
                  Edit Order
                </Button>
                <Button variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50" disabled={locked || busy} onClick={() => setShowCancelAction(true)}>
                  Cancel SO
                </Button>
              </div>
            </div>

            <ConfirmDialog
              isOpen={showConfirmAction}
              onClose={() => setShowConfirmAction(false)}
              onConfirm={handleConfirm}
              title="Confirm Sales Order"
              description={`Are you sure you want to confirm order ${so.DocuNo || so.SOID}? This will lock the order for warehouse processing.`}
              confirmText="Confirm Order"
            />

            <ConfirmDialog
              isOpen={showCancelAction}
              onClose={() => setShowCancelAction(false)}
              onConfirm={handleCancel}
              variant="danger"
              title="Cancel & Delete Order"
              description={`⚠️ DANGER: Are you sure you want to CANCEL and DELETE order ${so.DocuNo || so.SOID}? This action cannot be undone.`}
              confirmText="Delete Permanently"
            />

            <UnlockModal 
              isOpen={showUnlockModal}
              onClose={() => setShowUnlockModal(false)}
              onConfirm={handleUnlock}
              soId={so.DocuNo || so.SOID}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
