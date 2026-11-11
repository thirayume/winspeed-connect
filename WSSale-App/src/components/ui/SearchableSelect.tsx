import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  disabled?: boolean;
  keywords?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string, option?: SearchableSelectOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  dropdownClassName?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = '-- เลือกรายการ --',
  searchPlaceholder = 'พิมพ์ค้นหา...',
  emptyText = 'ไม่พบรายการที่ตรงกัน',
  allowClear = false,
  disabled = false,
  className = '',
  dropdownClassName = '',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find(o => o.value === value) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      const hay = `${o.label} ${o.sublabel || ''} ${o.value} ${o.keywords || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open]);

  const handleSelect = (opt: SearchableSelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value, opt);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!disabled) setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[highlightIdx];
      if (target) handleSelect(target);
    }
  };

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center justify-between gap-2 bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#0C447C]/30 focus:border-[#0C447C] ${
          disabled ? 'opacity-60 cursor-not-allowed bg-gray-100' : 'hover:border-gray-400 cursor-pointer'
        }`}
      >
        <span className={`truncate ${selected ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {allowClear && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={e => {
                e.stopPropagation();
                onChange('', undefined);
              }}
              className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              title="ล้างค่า"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && !disabled && (
        <div className={`absolute z-50 left-0 right-0 mt-1 min-w-[240px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden ${dropdownClassName}`}>
          <div className="p-2 border-b border-gray-100 bg-gray-50/60">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0C447C]/25 focus:border-[#0C447C]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400">{emptyText}</div>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isActive = idx === highlightIdx;
                return (
                  <button
                    key={`${opt.value}-${idx}`}
                    type="button"
                    disabled={opt.disabled}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => handleSelect(opt)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors ${
                      opt.disabled
                        ? 'opacity-50 cursor-not-allowed bg-gray-50'
                        : isSelected
                          ? 'bg-blue-50 text-[#0C447C] font-semibold'
                          : isActive
                            ? 'bg-gray-100 text-gray-900'
                            : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate">{opt.label}</div>
                      {opt.sublabel && <div className="text-[10px] text-gray-400 truncate">{opt.sublabel}</div>}
                    </div>
                    {opt.badge && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                        {opt.badge}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
