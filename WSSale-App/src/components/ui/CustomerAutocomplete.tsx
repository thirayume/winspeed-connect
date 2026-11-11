import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { fetchCustomers } from '../../services/api';
import type { EMCust } from '../../types';

export interface SelectedCustomerValue {
  custId: string;
  custCode?: string;
  custName: string;
  creditDays?: number | null;
}

interface CustomerAutocompleteProps {
  value: string;
  custName?: string;
  customers?: EMCust[];
  onChange: (cust: SelectedCustomerValue | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const CustomerAutocomplete: React.FC<CustomerAutocompleteProps> = ({
  value,
  custName,
  customers: providedCustomers,
  onChange,
  placeholder = 'ค้นหารหัส หรือ ชื่อร้านค้า...',
  disabled = false,
  className = '',
}) => {
  const [customers, setCustomers] = useState<EMCust[]>(providedCustomers || []);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (providedCustomers && providedCustomers.length > 0) {
      setCustomers(providedCustomers);
      return;
    }
    let alive = true;
    fetchCustomers({ limit: 500 })
      .then(list => {
        if (alive && Array.isArray(list)) setCustomers(list);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [providedCustomers]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers
      .filter(c =>
        String(c.CustCode || '').toLowerCase().includes(q) ||
        String(c.CustID || '').toLowerCase().includes(q) ||
        String(c.CustName || '').toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [customers, search]);

  const matchedSelected = useMemo(
    () => customers.find(c => String(c.CustID) === String(value) || String(c.CustCode) === String(value)),
    [customers, value]
  );

  if (value) {
    const displayName = custName || matchedSelected?.CustName || value;
    const displayCode = matchedSelected?.CustCode || value;
    return (
      <div className={`flex items-center justify-between gap-2 bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 text-xs text-[#0C447C] font-semibold ${className}`}>
        <span className="truncate">[{displayCode}] {displayName}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setSearch('');
              setOpen(true);
            }}
            className="text-gray-400 hover:text-red-500 shrink-0"
            title="เปลี่ยนลูกค้า"
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={search}
        disabled={disabled}
        onChange={e => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !disabled && setOpen(true)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0C447C]/25 focus:border-[#0C447C] bg-white"
      />
      {open && !disabled && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto divide-y divide-gray-50">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400 text-center">ไม่พบข้อมูลลูกค้า</div>
          ) : (
            filtered.map(c => (
              <button
                key={String(c.CustID)}
                type="button"
                onClick={() => {
                  onChange({
                    custId: String(c.CustCode || c.CustID),
                    custCode: String(c.CustCode || c.CustID),
                    custName: c.CustName,
                    creditDays: c.CreditDays ?? null,
                  });
                  setSearch('');
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-bold text-[#0C447C] truncate">{c.CustName}</div>
                  <div className="text-[10px] text-gray-400">รหัส: {c.CustCode || c.CustID}</div>
                </div>
                <span className="text-[10px] text-gray-500 shrink-0">
                  {c.CreditDays === 0 ? 'เงินสด' : `${c.CreditDays ?? 60} วัน`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
