import type { SOStatus } from '../types';

export const SO_STATUS_ORDER: SOStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'PICKING',
  'LOADED',
  'SHIPPED',
  'IMPORTED',
  'CANCELLED',
];

export const SO_STATUS_META: Record<SOStatus, {
  label: string;
  color: string;
  bg: string;
  badgeClass: string;
}> = {
  DRAFT: {
    label: 'ร่าง',
    color: '#9CA3AF',
    bg: '#F3F4F6',
    badgeClass: 'bg-gray-100 text-gray-600 border-gray-200',
  },
  CONFIRMED: {
    label: 'รอจัดส่ง',
    color: '#0C447C',
    bg: '#EFF6FF',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  PICKING: {
    label: 'รอรับสินค้า',
    color: '#F59E0B',
    bg: '#FFFBEB',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  LOADED: {
    label: 'โหลดสินค้า',
    color: '#7C3AED',
    bg: '#F5F3FF',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  SHIPPED: {
    label: 'ส่งออกจากตาชั่ง',
    color: '#059669',
    bg: '#ECFDF5',
    badgeClass: 'bg-green-50 text-green-700 border-green-200',
  },
  IMPORTED: {
    label: 'ปิด SO ใน WINSpeed',
    color: '#10B981',
    bg: '#ECFDF5',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  CANCELLED: {
    label: 'ยกเลิก',
    color: '#EF4444',
    bg: '#FEF2F2',
    badgeClass: 'bg-red-50 text-red-600 border-red-200',
  },
};

export const soStatusLabel = (status?: string | null) =>
  status && status in SO_STATUS_META ? SO_STATUS_META[status as SOStatus].label : (status || '-');

export const soStatusMeta = (status?: string | null) =>
  status && status in SO_STATUS_META ? SO_STATUS_META[status as SOStatus] : null;
