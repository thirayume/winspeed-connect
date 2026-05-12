import React, { useState, useEffect } from "react";
import { Calendar } from "lucide-react";
import { Modal } from "../ui/Modal";
import { SearchableSelect } from "../ui/SearchableSelect";
import { POSLayout } from "./POSLayout";
import { updateSO, fetchCustomers, fetchItems } from "../../services/api";
import type { EMCust, EMGood, SOWithDetails, SOLine } from "../../types";

export function EditSODialog({ 
  isOpen, 
  onClose, 
  onUpdated, 
  so 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onUpdated?: () => void,
  so: SOWithDetails | null 
}) {
  const [customers, setCustomers] = useState<EMCust[]>([]);
  const [items, setItems] = useState<EMGood[]>([]);
  const [custId, setCustId] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [lines, setLines] = useState<SOLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchCustomers().then(setCustomers);
      fetchItems().then(setItems);
      if (so) {
        setCustId(so.CustID);
        setRequestedDate(so.RequestedDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
        setLines(so.lines.map(l => ({
          GoodID: l.GoodID,
          GoodQty1: l.GoodQty1,
          GoodPrice1: l.GoodPrice1,
          ListNo: l.ListNo
        })));
      }
    }
  }, [isOpen, so]);

  const handleAddLine = (item: EMGood) => {
    setLines(prev => {
      const existing = prev.find(l => l.GoodID === item.GoodID);
      if (existing) {
        return prev.map(l => l.GoodID === item.GoodID ? { ...l, GoodQty1: l.GoodQty1 + 1 } : l);
      }
      return [{ 
        GoodID: item.GoodID, 
        GoodQty1: 1, 
        GoodPrice1: item.GoodPrice1,
        ListNo: prev.length + 1
      }, ...prev];
    });
  };

  const handleUpdateQty = (goodId: string, qty: number) => {
    if (qty <= 0) {
      handleRemoveLine(goodId);
      return;
    }
    setLines(prev => prev.map(l => l.GoodID === goodId ? { ...l, GoodQty1: qty } : l));
  };

  const handleRemoveLine = (goodId: string) => {
    setLines(prev => prev.filter(l => l.GoodID !== goodId));
  };

  const handleSubmit = async () => {
    if (!so) return;
    if (!custId) return alert("Select a customer");
    if (!lines.length) return alert("Add at least one item");
    
    setSubmitting(true);
    try {
      await updateSO(so.SOID, { CustID: custId, RequestedDate: requestedDate, lines: lines } as any);
      onUpdated?.();
      onClose();
    } catch (err) {
      console.error(err);
      alert("Failed to update Sales Order");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit Sales Order — ${so?.SOID}`} size="full">
      <div className="flex flex-col h-full overflow-hidden">
        {/* Top Header Controls */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-white border-b border-border shrink-0">
          <SearchableSelect 
            label="Customer"
            placeholder="Search customers..."
            value={custId}
            onChange={setCustId}
            options={customers.map(c => ({ value: c.CustID, label: `${c.CustID} — ${c.CustName}` }))}
          />
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-foreground">Requested Ship Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <input 
                type="date"
                value={requestedDate}
                onChange={(e) => setRequestedDate(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
              />
            </div>
          </div>
        </div>

        {/* POS Layout Interface */}
        <div className="flex-1 overflow-hidden">
          <POSLayout 
            items={items}
            lines={lines}
            onAddLine={handleAddLine}
            onUpdateQty={handleUpdateQty}
            onRemoveLine={handleRemoveLine}
            onConfirm={handleSubmit}
            isSubmitting={submitting}
          />
        </div>
      </div>
    </Modal>
  );
}
