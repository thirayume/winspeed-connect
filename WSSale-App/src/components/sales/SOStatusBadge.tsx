import React from 'react';
import { Badge } from '../ui/Base';
import type { SOStatus } from '../../types';

export const SOStatusBadge = ({ status }: { status: SOStatus }) => {
  const getBadgeStyle = () => {
    switch (status) {
      case 'Draft':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'Confirmed':
        return 'bg-[var(--color-status-confirmed)]/10 text-[var(--color-status-confirmed)] border-[var(--color-status-confirmed)]/20';
      case 'Picking':
        return 'bg-[var(--color-status-picking)]/10 text-[var(--color-status-picking)] border-[var(--color-status-picking)]/20';
      case 'Shipped':
        return 'bg-[var(--color-status-shipped)]/10 text-[var(--color-status-shipped)] border-[var(--color-status-shipped)]/20';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border ${getBadgeStyle()}`}>
      {status}
    </span>
  );
};
