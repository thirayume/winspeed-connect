'use strict';
/**
 * เงื่อนไขการวางบิลของลูกหนี้ เป็นข้อความเดียวกับฟอร์มใบสั่งจองของ WinSpeed (dr_so_confirmorder_wf)
 * EMCust.BillState: 1 ทุกวัน · 2 ตามวันในสัปดาห์ (BillDay 7 ช่อง ช่องละ 3 ตัว) · 3 ตามวันที่ (BillDate 31 ช่อง ช่องละ 2 ตัว)
 * 4 ตามสัปดาห์ที่ (BillWeek 5 ช่อง) · 5 วันในสัปดาห์ของสัปดาห์ที่ · อื่น ๆ (เช่น 'N') = ไม่แสดง
 * ช่องที่เป็นขีดทั้งช่อง ('---' / '--') คือไม่เลือก เหมือนใน WinSpeed
 */
const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

function picked(raw, size, labels) {
  const s = String(raw ?? '');
  return labels.filter((_, i) => s.substr(i * size, size) !== '-'.repeat(size)).join(' ');
}

function billTermsText({ BillState, BillDay, BillDate, BillWeek } = {}) {
  const days = () => picked(BillDay, 3, DAYS);
  const weeks = () => picked(BillWeek, 2, ['1', '2', '3', '4', '5']);
  switch (String(BillState ?? '').trim()) {
    case '1': return 'วางบิลทุกวัน';
    case '2': return `ทุกวัน ${days()}`.trim();
    case '3': return `ทุกวันที่ ${picked(BillDate, 2, Array.from({ length: 31 }, (_, i) => String(i + 1)))}`.trim();
    case '4': return `ทุกสัปดาห์ที่ ${weeks()}`.trim();
    case '5': return `ทุกวัน ${days()} ของสัปดาห์ที่ ${weeks()}`.trim();
    default: return '';
  }
}

module.exports = { billTermsText };
