import { GiveawayQuotaLoansPanel } from '../giveaway/GiveawayQuotaLoansPanel';

interface GiveawayBorrowModalProps {
  isOpen: boolean;
  onClose: () => void;
  brand: string;
  itemName: string;
  requiredQty: number;
  periodYear: number;
  onSuccess: () => void;
}

export function GiveawayBorrowModal({ isOpen, onClose, brand, itemName, requiredQty, periodYear, onSuccess }: GiveawayBorrowModalProps) {
  if (!isOpen) return null;
  return <div role="dialog" aria-modal="true" aria-label="ยืมโควต้าของแถมสำหรับบิล" className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
    <div className="mx-auto max-w-4xl rounded-xl bg-white p-4 shadow-xl">
      <button type="button" onClick={onClose} className="rounded border px-3 py-2">ปิดคำขอยืม</button>
      <p className="mt-3 text-sm text-gray-600">รายการในบิล: {brand} · {itemName} · ต้องการเพิ่ม {requiredQty} ชิ้น</p>
      <GiveawayQuotaLoansPanel initialYear={periodYear} onChanged={onSuccess} />
    </div>
  </div>;
}
