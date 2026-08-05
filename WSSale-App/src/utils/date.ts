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
 * Formats a given date (string or Date object) into Thai Buddhist Era format.
 * Format: dd/MM/yyyy [hh:mm]
 * Example: 31/12/2569 14:30
 *
 * ⚠ ใช้กับค่าที่เป็น **ค.ศ.** เท่านั้น (Date, ISO string, SQL datetime)
 */
export function formatThaiDate(dateStr: string | Date | undefined | null, includeTime: boolean = false): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear() + 543;
  
  let formatted = `${day}/${month}/${year}`;
  
  if (includeTime) {
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    formatted += ` ${hours}:${mins}`;
  }
  
  return formatted;
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
  if (!gregorianStr) return '';
  const d = new Date(gregorianStr);
  if (isNaN(d.getTime())) return '';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear() + 543;
  
  return `${day}/${month}/${year}`;
}
