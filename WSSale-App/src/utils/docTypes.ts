/**
 * What each WinSpeed document number means, in the words on Sale-App and WinSpeed screens. Show the words first and the
 * number in brackets; a bare 103 or 107 means nothing to the people using these screens.
 *
 * `form` is the name printed on the paper, as accounting confirmed on 12 November 2026.
 */
export const DOC_TYPES: Record<string, { name: string; menu: string; meaning: string; form?: string }> = {
  '102': { name: 'ใบเสนอราคา', menu: 'ใบเสนอราคา', meaning: 'เสนอราคาให้ลูกค้า ยังไม่ใช่การขาย' },
  '113': { name: 'ใบอนุมัติเสนอราคา', menu: 'อนุมัติใบเสนอราคา', meaning: 'ลูกค้าตกลงราคาแล้ว' },
  '103': { name: 'ใบสั่งจอง', menu: 'ใบสั่งจอง (WF)', meaning: 'บิลที่ยืนยันแล้วจาก Sale-App รอ WinSpeed อนุมัติ', form: 'ใบสั่งจอง กระดาษ A4' },
  AI: { name: 'ใบอนุมัติใบสั่งจอง', menu: 'อนุมัติใบสั่งจอง (WF)', meaning: 'ผู้มีอำนาจอนุมัติใบสั่งจองแล้ว เลขขึ้นต้น AI' },
  '104': { name: 'ใบสั่งขาย', menu: 'ใบสั่งขาย (WF)', meaning: 'เปิดการขายจริง WinSpeed ออกตั๋วปุ๋ยและใบตั้งหนี้ (202) พร้อมกัน', form: 'ใบสั่งขาย ฟอร์มต่อเนื่องจากโรงพิมพ์ ชุดละ 4 แผ่น' },
  CD: { name: 'ตั๋วปุ๋ย', menu: 'Coupon ในใบสั่งขาย (WF)', meaning: 'สิทธิ์รับปุ๋ยตามใบสั่งขาย สาย I ได้เลข C สาย K ได้เลข D ลูกค้าทยอยขนได้จนครบจำนวน', form: 'ใบสั่งจ่ายสินค้า กระดาษจากโรงพิมพ์' },
  '105': { name: 'ใบจัดของ', menu: 'ใบจัดของ', meaning: 'ใบจัดสินค้าในคลัง' },
  '116': { name: 'ใบตัดตั๋วปุ๋ย', menu: 'ตัดตั๋วปุ๋ย (WF)', meaning: 'ตัดตั๋วทุกครั้งที่ขนของออก เลขที่ใบขนคือเลขที่ใบเคลื่อนย้ายบนใบจ่ายสินค้าของโกดัง (ใบชั่งและใบขนคือใบเดียวกัน)', form: 'ใบจ่ายสินค้า ออกจากโกดัง' },
  '107': { name: 'ใบส่งของ', menu: 'Post Invoice (WF) → ขายเชื่อ', meaning: 'บันทึกขายและตัดสต๊อกตามวันที่ขนจริง สาย I ได้เล่ม J สาย K ได้เล่ม N', form: 'ใบส่งของ (ไม่มีภาษี) กระดาษ A4' },
  '202': { name: 'ใบตั้งหนี้', menu: 'ตั้งหนี้ลูกหนี้อื่น ๆ', meaning: 'ตั้งลูกหนี้ตอนออกใบสั่งขาย เลขเดียวกับใบสั่งขาย รายงานอายุลูกหนี้ ใบส่งของค้างชำระ และการรับชำระ นับจากใบนี้' },
  '106': { name: 'ใบคืนรีเบท', menu: 'ใบ RB', meaning: 'เอกสารเคลียร์รีเบท เลขขึ้นต้น RB, RD, TB' },
  '108': { name: 'ใบขายเงินสด', menu: 'ขายเงินสด', meaning: 'ขายเงินสด' },
  '109': { name: 'ใบลดหนี้', menu: 'รับคืน, ลดหนี้', meaning: 'ลดหนี้ลูกค้า' },
  '110': { name: 'ใบเพิ่มหนี้', menu: 'เพิ่มหนี้', meaning: 'เพิ่มหนี้ลูกค้า' },
  '117': { name: 'ใบยกเลิกตั๋วปุ๋ย', menu: 'ยกเลิกตั๋วปุ๋ย (ล้างตั๋ว) (WF)', meaning: 'ยกเลิกตั๋วที่ออกไปแล้ว' },
};

/** "ใบสั่งขาย (104)"; a key that is not a number, such as the ticket, shows its name alone */
export function docLabel(type: string | number): string {
  const key = String(type);
  const t = DOC_TYPES[key];
  if (!t) return key;
  return /^[0-9]+$/.test(key) ? `${t.name} (${key})` : t.name;
}

/** The documents of one sale in the order they appear, for the guide next to the bill list. */
export const SALE_CHAIN: string[] = ['103', 'AI', '104', 'CD', '202', '116', '107'];
