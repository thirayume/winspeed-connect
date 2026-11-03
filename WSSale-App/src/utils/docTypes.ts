/**
 * What each WinSpeed document number means, in the words on Sale-App and WinSpeed screens. Show the words first and the
 * number in brackets; a bare 103 or 107 means nothing to the people using these screens.
 */
export const DOC_TYPES: Record<string, { name: string; menu: string; meaning: string }> = {
  '102': { name: 'ใบเสนอราคา', menu: 'ใบเสนอราคา', meaning: 'เสนอราคาให้ลูกค้า ยังไม่ใช่การขาย' },
  '113': { name: 'ใบอนุมัติเสนอราคา', menu: 'อนุมัติใบเสนอราคา', meaning: 'ลูกค้าตกลงราคาแล้ว' },
  '103': { name: 'ใบสั่งจอง', menu: 'ใบสั่งจอง (WF)', meaning: 'บิลที่ยืนยันแล้วจาก Sale-App รอ WinSpeed อนุมัติ' },
  AI: { name: 'ใบอนุมัติใบสั่งจอง', menu: 'อนุมัติใบสั่งจอง (WF)', meaning: 'ผู้มีอำนาจอนุมัติใบสั่งจองแล้ว เลขขึ้นต้น AI' },
  '104': { name: 'ใบสั่งขาย', menu: 'ใบสั่งขาย (WF)', meaning: 'เปิดการขายจริง ออกตั๋วปุ๋ย และตั้งหนี้' },
  '105': { name: 'ใบจัดของ', menu: 'ใบจัดของ', meaning: 'ใบจัดสินค้าในคลัง' },
  '116': { name: 'ใบตัดตั๋วปุ๋ย', menu: 'ตัดตั๋วปุ๋ย (WF)', meaning: 'ตัดตั๋วเมื่อขนของออก เลขที่คือเลขใบขนจากตาชั่ง' },
  '107': { name: 'ใบส่งของ', menu: 'Post Invoice (WF)', meaning: 'ลงบัญชีขาย ตัดสต๊อก สาย I ได้เล่ม J สาย K ได้เล่ม N' },
  '202': { name: 'ใบตั้งหนี้', menu: 'ตั้งหนี้ลูกหนี้อื่น ๆ', meaning: 'ตั้งลูกหนี้ตอนออกใบสั่งขาย เลขเดียวกับใบสั่งขาย' },
  '106': { name: 'ใบคืนรีเบท', menu: 'ใบ RB', meaning: 'เอกสารเคลียร์รีเบท เลขขึ้นต้น RB, RD, TB' },
  '108': { name: 'ใบขายเงินสด', menu: 'ขายเงินสด', meaning: 'ขายเงินสด' },
  '109': { name: 'ใบลดหนี้', menu: 'รับคืน, ลดหนี้', meaning: 'ลดหนี้ลูกค้า' },
  '110': { name: 'ใบเพิ่มหนี้', menu: 'เพิ่มหนี้', meaning: 'เพิ่มหนี้ลูกค้า' },
  '117': { name: 'ใบยกเลิกตั๋วปุ๋ย', menu: 'ยกเลิกตั๋วปุ๋ย (ล้างตั๋ว) (WF)', meaning: 'ยกเลิกตั๋วที่ออกไปแล้ว' },
};

/** "ใบสั่งขาย (104)" */
export function docLabel(type: string | number): string {
  const key = String(type);
  const t = DOC_TYPES[key];
  return t ? `${t.name} (${key})` : key;
}
