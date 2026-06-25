import type { SOStatus } from '../../types';

const STATUS_STYLE: Record<SOStatus, string> = {
  DRAFT:      'bg-gray-100 text-gray-600 border-gray-200',
  CONFIRMED:  'bg-blue-50 text-blue-700 border-blue-200',
  PICKING:    'bg-amber-50 text-amber-700 border-amber-200',
  SHIPPED:    'bg-green-50 text-green-700 border-green-200',
  IMPORTED:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED:  'bg-red-50 text-red-600 border-red-200',
};

const STATUS_TH: Record<SOStatus, string> = {
  DRAFT:      'ร่าง',
  CONFIRMED:  'ยืนยัน',
  PICKING:    'รอรับสินค้า',
  SHIPPED:    'ส่งออก',
  IMPORTED:   'นำเข้า WS แล้ว',
  CANCELLED:  'ยกเลิก',
};

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
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border uppercase tracking-tight ${STATUS_STYLE[status] || ''}`}>
      {STATUS_TH[status] || status}
    </span>
  );
};
