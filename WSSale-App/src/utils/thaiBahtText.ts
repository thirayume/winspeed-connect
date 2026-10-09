// Amount in Thai words for printed documents, e.g. 39000 → "สามหมื่นเก้าพันบาทถ้วน", 12.5 → "สิบสองบาทห้าสิบสตางค์"
const DIGIT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACE = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** words for 0…999,999 */
function underMillion(n: number): string {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const place = s.length - i - 1;
    if (d === 0) continue;
    if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else if (place === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
    else out += DIGIT[d] + PLACE[place];
  }
  return out;
}

function integerWords(n: number): string {
  if (n === 0) return 'ศูนย์';
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  return (millions ? integerWords(millions) + 'ล้าน' : '') + (rest ? underMillion(rest) : '');
}

export function thaiBahtText(amount: number): string {
  const satangTotal = Math.round(Math.abs(Number(amount) || 0) * 100);
  const baht = Math.floor(satangTotal / 100);
  const satang = satangTotal % 100;
  const sign = Number(amount) < 0 ? 'ลบ' : '';
  return sign + integerWords(baht) + 'บาท' + (satang ? integerWords(satang) + 'สตางค์' : 'ถ้วน');
}
