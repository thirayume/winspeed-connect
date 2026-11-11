/**
 * วันที่ในระบบมาจากสองแหล่งที่เก็บคนละแบบ — เลือกฟังก์ชันให้ถูกแหล่ง
 *
 *   WINSpeed (dbo) และตารางของแอป (wf)  เก็บเป็น ค.ศ. → ใช้ formatThaiDate() ซึ่งบวก 543
 *   ฐานเครื่องชั่ง (MySQL) Date_In/Date_Out เก็บเป็น **พ.ศ. อยู่แล้ว** ในรูป 'DD/MM/BBBB'
 *     รวมถึงสำเนาใน wf.WeighInbox.DateIn/DateOut → ใช้ formatBuddhistDateString()
 *
 * ถ้าเผลอส่งค่า พ.ศ. เข้า formatThaiDate() จะผิดสองชั้น: new Date('01/05/2569')
 * ตีความแบบอเมริกันเป็นเดือน/วัน แล้วบวก 543 อีก ได้ปี 3112 ซึ่งเคยขึ้นจริงบนหน้าจอ
 */

/**
 * Today's date in Thailand as YYYY-MM-DD, or n days back. toISOString() alone gives the UTC date,
 * which is still yesterday until 07:00 here.
 */
export function bangkokDate(daysAgo: number = 0): string {
  return new Date(Date.now() + 7 * 3600000 - daysAgo * 86400000).toISOString().slice(0, 10);
}

/**
 * Formats a given date (string or Date object) into Thai Buddhist Era format.
 * Format: dd/MM/yyyy [HH:mm] (24-hour clock in Asia/Bangkok)
 * Example: 31/12/2569 14:30
 *
 * ⚠ ใช้กับค่าที่เป็น **ค.ศ.** เท่านั้น (Date, ISO string, SQL datetime)
 */
function extractBangkokParts(input: string | Date | undefined | null): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
} | null {
  if (!input) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return {
        year: Number(dateOnly[1]),
        month: Number(dateOnly[2]),
        day: Number(dateOnly[3]),
        hours: 0,
        minutes: 0,
      };
    }
    const isoMidnight = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})?$/);
    if (isoMidnight) {
      return {
        year: Number(isoMidnight[1]),
        month: Number(isoMidnight[2]),
        day: Number(isoMidnight[3]),
        hours: 0,
        minutes: 0,
      };
    }
    // Plain SQL datetime without TZ offset (e.g. "2026-11-10 14:30" or "2026-11-10 14:30:00") — already Bangkok wall clock
    const wallDt = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    if (wallDt) {
      return {
        year: Number(wallDt[1]),
        month: Number(wallDt[2]),
        day: Number(wallDt[3]),
        hours: Number(wallDt[4]),
        minutes: Number(wallDt[5]),
      };
    }
  }
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;
  const bkk = new Date(d.getTime() + 7 * 3600000);
  return {
    year: bkk.getUTCFullYear(),
    month: bkk.getUTCMonth() + 1,
    day: bkk.getUTCDate(),
    hours: bkk.getUTCHours(),
    minutes: bkk.getUTCMinutes(),
  };
}

export function formatThaiDate(dateStr: string | Date | undefined | null, includeTime: boolean = false): string {
  const p = extractBangkokParts(dateStr);
  if (!p) return '-';

  const day = String(p.day).padStart(2, '0');
  const month = String(p.month).padStart(2, '0');
  const year = p.year + 543;

  let formatted = `${day}/${month}/${year}`;

  if (includeTime) {
    const hours = String(p.hours).padStart(2, '0');
    const mins = String(p.minutes).padStart(2, '0');
    formatted += ` ${hours}:${mins}`;
  }

  return formatted;
}

export function formatThaiTime24h(dateStr: string | Date | undefined | null): string {
  const p = extractBangkokParts(dateStr);
  if (!p) return '-';
  return `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
}

/**
 * แสดงวันที่ที่ฐานข้อมูลเก็บเป็น พ.ศ. อยู่แล้ว — ไม่แปลงปี เพียงตรวจว่ารูปแบบใช้ได้
 *
 * ใช้กับ Date_In / Date_Out ของฐานเครื่องชั่ง และสำเนาใน wf.WeighInbox
 * ค่าที่ว่าง เป็น '0' หรือรูปแบบผิด จะคืน placeholder แทนการเดา
 *
 * รับ 'DD/MM/BBBB' และ 'DD/MM/BB' (บางแถวเก่าเก็บปีสองหลัก)
 */
export function formatBuddhistDateString(
  value: string | null | undefined,
  placeholder: string = '-',
): string {
  if (value === null || value === undefined) return placeholder;
  const raw = String(value).trim();
  if (!raw || raw === '0') return placeholder;

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return placeholder;

  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return placeholder;

  // ปีสองหลักในฐานนี้หมายถึง พ.ศ. เช่น 69 = 2569 ไม่ใช่ ค.ศ. 1969
  const year = m[3].length === 2 ? 2500 + Number(m[3]) : Number(m[3]);

  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/**
 * Parses a Thai Buddhist date string (dd/MM/yyyy) into a standard YYYY-MM-DD format
 * Returns null if the format is invalid.
 */
export function parseThaiDateToGregorian(thaiDateStr: string): string | null {
  if (!thaiDateStr) return null;
  const parts = thaiDateStr.trim().split(' ');
  const datePart = parts[0];
  
  const match = datePart.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  
  const day = match[1];
  const month = match[2];
  const year = parseInt(match[3], 10) - 543;
  
  return `${year}-${month}-${day}`;
}

/**
 * Converts a standard YYYY-MM-DD date string to dd/MM/yyyy (Buddhist Era) for inputs
 */
export function toThaiDateInputFormat(gregorianStr: string | undefined | null): string {
  const p = extractBangkokParts(gregorianStr);
  if (!p) return '';
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year + 543}`;
}
