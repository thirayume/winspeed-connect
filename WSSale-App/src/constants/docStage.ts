import type { DocStage, DocStageCode } from '../types';

/**
 * How far a bill has gone in WinSpeed's own documents, in the words accounting uses (their answers of
 * 12 November 2026). The bill's status chip says where the work is; this says which document exists.
 *
 *   ใบสั่งจอง (103) → อนุมัติ (เลข AI) → ใบสั่งขาย (104) พร้อมตั๋วปุ๋ย C/D และใบตั้งหนี้ (202)
 *   → ใบตัดตั๋วปุ๋ย (116) ทุกครั้งที่ขน → ใบส่งของ (107) เล่ม J หรือ N
 */
export const DOC_STAGE_META: Record<DocStageCode, { label: string; hint: string; badgeClass: string }> = {
  DRAFT: {
    label: 'บิลร่าง · ยังไม่มีเอกสาร WinSpeed',
    hint: 'บิลอยู่ใน Sale-App เท่านั้น เมื่อยืนยันทริปจึงออกใบสั่งจอง (103) ใน WinSpeed',
    badgeClass: 'bg-gray-50 text-gray-600 border-gray-200',
  },
  BOOKING_WAITING_APPROVAL: {
    label: 'ใบสั่งจอง (103) · รออนุมัติ',
    hint: 'ออกใบสั่งจองใน WinSpeed แล้ว รอผู้มีอำนาจอนุมัติ เมื่ออนุมัติจะได้เลข AI',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  BOOKING_APPROVED: {
    label: 'ใบสั่งจอง (103) · อนุมัติแล้ว รอใบสั่งขาย',
    hint: 'ใบสั่งจองได้เลขอนุมัติ AI แล้ว ขั้นต่อไปคือออกใบสั่งขาย (104)',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  BOOKING_ORDERED: {
    label: 'ใบสั่งขาย (104) · ออกแล้ว',
    hint: 'ใบสั่งจองนี้ถูกนำไปออกใบสั่งขาย (104) แล้ว',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  ORDER_ISSUED: {
    label: 'ใบสั่งขาย (104) · ออกแล้ว ไม่มีตั๋วปุ๋ย',
    hint: 'ออกใบสั่งขายแล้ว แต่ไม่พบตั๋วปุ๋ยของใบนี้ ให้ตรวจใน WinSpeed',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  TICKET_ISSUED: {
    label: 'ใบสั่งขาย (104) · ออกตั๋วปุ๋ยแล้ว ยังไม่ขน',
    hint: 'WinSpeed ออกตั๋วปุ๋ย (C/D) และใบตั้งหนี้ (202) พร้อมใบสั่งขายแล้ว ลูกหนี้เริ่มนับจากขั้นนี้ ยังไม่มีการขนสินค้า',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  TICKET_CLOSED_WITHOUT_CUT: {
    label: 'ใบสั่งขาย (104) · ตั๋วไม่มียอดเหลือ ไม่พบใบตัดตั๋ว',
    hint: 'ตั๋วปุ๋ยไม่มียอดคงเหลือแล้ว แต่ไม่พบใบตัดตั๋วปุ๋ย (116) ของตั๋วนี้ เช่น กรณีรับคืนตั๋ว ให้ตรวจใน WinSpeed',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  CUT_PARTLY: {
    label: 'ตัดตั๋ว (116) · ขนแล้วบางส่วน รอใบส่งของ',
    hint: 'ขนสินค้าและตัดตั๋วปุ๋ยแล้วบางส่วน ตั๋วยังมียอดคงเหลือ และยังไม่ได้ออกใบส่งของ (107) ของส่วนที่ขน',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  CUT_WAITING_INVOICE: {
    label: 'ตัดตั๋ว (116) · ขนครบ รอใบส่งของ (107)',
    hint: 'ขนสินค้าครบตามตั๋วและตัดตั๋วปุ๋ยแล้ว รอบัญชีออกใบส่งของ (107) ด้วย Post Invoice',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  INVOICED_PARTLY: {
    label: 'ใบส่งของ (107) · ออกแล้วบางส่วน',
    hint: 'ออกใบส่งของ (107) แล้วสำหรับส่วนที่ขน ยังมีตั๋วคงเหลือหรือมีการขนที่ยังไม่ออกใบส่งของ',
    badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  INVOICED: {
    label: 'ใบส่งของ (107) · ออกครบแล้ว',
    hint: 'ขนครบและออกใบส่งของ (107) ครบแล้ว เอกสารฝั่งขายจบสาย ส่วนการรับชำระดูที่ใบตั้งหนี้ (202)',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  CANCELLED: {
    label: 'ยกเลิกใน WinSpeed',
    hint: 'เอกสารนี้ถูกยกเลิกใน WinSpeed',
    badgeClass: 'bg-red-50 text-red-600 border-red-200',
  },
};

const tonnes = (value?: number | null) =>
  (Number(value) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** "ตั๋ว 11.00 ตัน · ขนแล้ว 5.00 · คงเหลือ 6.00 · ออกใบส่งของแล้ว 5.00 (เล่ม J)", or '' when the bill has no ticket. */
export function docStageQuantities(stage?: DocStage | null): string {
  if (!stage || !(Number(stage.ticketQty) > 0)) return '';
  const parts = [`ตั๋ว ${tonnes(stage.ticketQty)} ตัน`, `ขนแล้ว ${tonnes(stage.cutQty)}`, `คงเหลือ ${tonnes(stage.ticketRemaining)}`];
  if (Number(stage.invoicedQty) > 0) {
    parts.push(`ออกใบส่งของแล้ว ${tonnes(stage.invoicedQty)}${stage.invoiceBook ? ` (เล่ม ${stage.invoiceBook})` : ''}`);
  }
  return parts.join(' · ');
}

export const docStageMeta = (stage?: DocStage | null) =>
  stage && stage.code in DOC_STAGE_META ? DOC_STAGE_META[stage.code] : null;

/** The order the chain is read in, for the guide. */
export const DOC_STAGE_ORDER: DocStageCode[] = [
  'DRAFT',
  'BOOKING_WAITING_APPROVAL',
  'BOOKING_APPROVED',
  'TICKET_ISSUED',
  'CUT_PARTLY',
  'CUT_WAITING_INVOICE',
  'INVOICED_PARTLY',
  'INVOICED',
  'TICKET_CLOSED_WITHOUT_CUT',
  'CANCELLED',
];
