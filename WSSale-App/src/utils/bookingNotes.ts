// Same repertoire/limits as the API; server and SP remain authoritative.
const noteDecoder = new TextDecoder('windows-874');
const noteChars = new Set(Array.from({ length: 256 }, (_, i) => noteDecoder.decode(Uint8Array.of(i))).filter(c => c !== '\uFFFD'));
export function bookingNoteError(value?: string | null): string | null {
  const text = (value || '').trim();
  if (text.length > 255) return 'หมายเหตุต้องไม่เกิน 255 ตัวอักษร';
  if ([...text].some(c => !noteChars.has(c))) return 'หมายเหตุมีอักขระที่ WinSpeed ไม่รองรับ (code page 874)';
  return null;
}
