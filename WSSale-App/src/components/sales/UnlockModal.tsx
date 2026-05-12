import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Base';
import { Unlock, MessageSquare, ChevronDown } from 'lucide-react';

const PRESET_REASONS = [
  "Customer changed mind",
  "Incorrect quantity/price",
  "Item substitution needed",
  "Special Request (Pre-order)",
  "Special Request (OT-Order)",
  "Other"
];

interface UnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  soId: string;
}

export function UnlockModal({ isOpen, onClose, onConfirm, soId }: UnlockModalProps) {
  const [reason, setReason] = useState(PRESET_REASONS[0]);
  const [customReason, setCustomReason] = useState("");

  const handleConfirm = () => {
    const finalReason = reason === "Other" ? customReason : reason;
    if (!finalReason) return alert("Please provide a reason");
    onConfirm(finalReason);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Request Order Unlock">
      <div className="space-y-6">
        <div className="flex items-start gap-4 p-4 rounded-xl bg-blue-50 border border-blue-100">
          <div className="shrink-0 h-10 w-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
            <Unlock size={20} />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-blue-900">Unlock Request: {soId}</h4>
            <p className="text-xs text-blue-700 mt-1 leading-relaxed">
              Locked orders require store approval to return to Draft state. Please select a reason for this request.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-foreground">Select Reason</label>
            <div className="relative">
              <select 
                value={reason} 
                onChange={(e) => setReason(e.target.value)}
                className="w-full appearance-none rounded-lg border border-border bg-white py-2.5 pl-3 pr-10 text-sm focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none transition-all shadow-sm"
              >
                {PRESET_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={16} />
            </div>
          </div>

          {reason === "Other" && (
            <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-200">
              <label className="text-sm font-semibold text-foreground">Specific Reason</label>
              <div className="relative">
                <MessageSquare className="absolute left-3 top-3 text-muted-foreground" size={16} />
                <textarea 
                  autoFocus
                  placeholder="Describe the reason..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white py-2.5 pl-10 pr-3 text-sm min-h-[100px] focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none transition-all shadow-sm"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            variant="primary"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleConfirm}
          >
            Send Request
          </Button>
        </div>
      </div>
    </Modal>
  );
}
