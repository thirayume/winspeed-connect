import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * One pagination bar for every list (owner, 18 Nov 2026: with 178 pages there was no way to reach page 100 or the
 * last page quickly). It offers first/previous/next/last, numbered pages around the current one, a "go to page"
 * box, and a rows-per-page choice that each screen remembers in this browser.
 */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** When given, the bar shows the rows-per-page choice. The caller should go back to page 1. */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /** What one row is, as shown in the summary: รายการ, บิล, ลูกค้า … */
  unit?: string;
  disabled?: boolean;
  /** Smaller bar without the summary and rows-per-page, for pickers inside dialogs. */
  compact?: boolean;
  className?: string;
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/** Page numbers to draw: the first, the last, and two either side of the current one; null is a gap. */
function pageWindow(page: number, totalPages: number): (number | null)[] {
  const wanted = new Set([1, totalPages, page - 2, page - 1, page, page + 1, page + 2]);
  const list = [...wanted].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) out.push(n - list[i - 1] === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
}

export function Pagination({
  page, total, pageSize, onPageChange, onPageSizeChange, pageSizeOptions = PAGE_SIZE_OPTIONS,
  unit = 'รายการ', disabled = false, compact = false, className = '',
}: PaginationProps) {
  const totalPages = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, page), totalPages);
  const [jump, setJump] = useState('');
  useEffect(() => { setJump(''); }, [current, totalPages]);

  const go = (target: number) => {
    const next = Math.min(Math.max(1, Math.trunc(target)), totalPages);
    if (!disabled && Number.isFinite(next) && next !== current) onPageChange(next);
  };
  const submitJump = () => {
    const n = Number(jump);
    if (jump.trim() && Number.isFinite(n)) go(n);
    setJump('');
  };

  const from = total > 0 ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, total);
  const btn = 'h-8 min-w-8 px-2 inline-flex items-center justify-center rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const idle = 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50';
  const sizes = [...new Set([...pageSizeOptions, pageSize])].sort((a, b) => a - b);

  return (
    <nav
      aria-label="แบ่งหน้า"
      data-testid="pagination"
      className={`flex flex-wrap items-center justify-between gap-2 text-xs ${className}`}
    >
      {!compact && (
        <div className="flex flex-wrap items-center gap-3 text-gray-500">
          <span data-testid="pagination-summary">
            แสดง {from.toLocaleString()}–{to.toLocaleString()} จาก {total.toLocaleString()} {unit}
          </span>
          {onPageSizeChange && (
            <label className="inline-flex items-center gap-1.5">
              <span>แสดง</span>
              <select
                data-testid="pagination-size"
                value={pageSize}
                disabled={disabled}
                onChange={e => onPageSizeChange(Number(e.target.value))}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0C447C]/20"
              >
                {sizes.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>แถวต่อหน้า</span>
            </label>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={`${btn} ${idle}`} onClick={() => go(1)} disabled={disabled || current <= 1}
          title="หน้าแรก" aria-label="หน้าแรก" data-testid="pagination-first">
          <ChevronsLeft size={14} />
        </button>
        <button type="button" className={`${btn} ${idle}`} onClick={() => go(current - 1)} disabled={disabled || current <= 1}
          title="หน้าก่อน" aria-label="หน้าก่อน" data-testid="pagination-prev">
          <ChevronLeft size={14} />
        </button>
        {compact ? (
          <span className="px-2 font-bold text-[#0C447C]">{current} / {totalPages}</span>
        ) : (
          pageWindow(current, totalPages).map((n, i) => n === null ? (
            <span key={`gap-${i}`} className="px-1 text-gray-400">…</span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => go(n)}
              disabled={disabled}
              aria-current={n === current ? 'page' : undefined}
              className={`${btn} ${n === current ? 'bg-[#0C447C] border-[#0C447C] text-white' : idle}`}
            >
              {n.toLocaleString()}
            </button>
          ))
        )}
        <button type="button" className={`${btn} ${idle}`} onClick={() => go(current + 1)} disabled={disabled || current >= totalPages}
          title="หน้าถัดไป" aria-label="หน้าถัดไป" data-testid="pagination-next">
          <ChevronRight size={14} />
        </button>
        <button type="button" className={`${btn} ${idle}`} onClick={() => go(totalPages)} disabled={disabled || current >= totalPages}
          title="หน้าสุดท้าย" aria-label="หน้าสุดท้าย" data-testid="pagination-last">
          <ChevronsRight size={14} />
        </button>
        {totalPages > 5 && (
          <form
            noValidate
            className="ml-1 inline-flex items-center gap-1"
            onSubmit={e => { e.preventDefault(); submitJump(); }}
          >
            <span className="text-gray-500">ไปหน้า</span>
            <input
              data-testid="pagination-jump"
              type="number"
              inputMode="numeric"
              min={1}
              max={totalPages}
              value={jump}
              disabled={disabled}
              onChange={e => setJump(e.target.value)}
              placeholder={String(current)}
              aria-label={`ไปหน้าที่ (1–${totalPages})`}
              className="h-8 w-16 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0C447C]/20"
            />
            <button type="submit" disabled={disabled || !jump.trim()} className={`${btn} ${idle}`} data-testid="pagination-go">ไป</button>
          </form>
        )}
      </div>
    </nav>
  );
}

/** Rows per page for one screen, remembered in this browser. */
export function usePageSize(screenKey: string, initial = 50, options = PAGE_SIZE_OPTIONS): [number, (size: number) => void] {
  const storageKey = `wf.pageSize.${screenKey}`;
  const [size, setSize] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      return options.includes(saved) ? saved : initial;
    } catch { return initial; }
  });
  const update = (next: number) => {
    setSize(next);
    try { window.localStorage.setItem(storageKey, String(next)); } catch { /* private window: keep it for this visit */ }
  };
  return [size, update];
}
