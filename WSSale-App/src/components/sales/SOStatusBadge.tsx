import type { SOStatus } from '../../types';
import { SO_STATUS_META } from '../../constants/soStatus';

export const SOStatusBadge = ({
  status,
  isUnlockRequested,
}: {
  status: SOStatus;
  isUnlockRequested?: boolean;
}) => {
  if (isUnlockRequested) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border bg-red-600 text-white border-red-700 animate-pulse">
        รอปลดล็อก
      </span>
    );
  }

  const meta = SO_STATUS_META[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border tracking-tight ${meta?.badgeClass || ''}`}>
      {meta?.label || status}
    </span>
  );
};
