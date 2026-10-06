'use strict';
// Match SQL varchar Thai_CI_AS (Windows code page 874), never best-fit replacement.
const decoder = new TextDecoder('windows-874');
const repertoire = new Set(Array.from({ length: 256 }, (_, byte) => decoder.decode(Uint8Array.of(byte))).filter(c => c !== '\uFFFD'));
function validateBookingNote(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw Object.assign(new Error('หมายเหตุต้องเป็นข้อความ'), { status: 400 });
  const text = value.trim();
  if (text.length > 255) throw Object.assign(new Error('หมายเหตุต้องไม่เกิน 255 ตัวอักษร'), { status: 400 });
  if ([...text].some(c => !repertoire.has(c))) throw Object.assign(new Error('หมายเหตุมีอักขระที่ WinSpeed ไม่รองรับ (code page 874)'), { status: 400 });
  return text;
}
function validateBookingNotes(body, fields = ['remark', 'truckRemark', 'billRemark']) {
  for (const field of fields) if (Object.hasOwn(body, field)) body[field] = validateBookingNote(body[field]);
  return body;
}
module.exports = { validateBookingNote, validateBookingNotes };
