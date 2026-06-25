/**
 * Formats a given date (string or Date object) into Thai Buddhist Era format.
 * Format: dd/MM/yyyy [hh:mm]
 * Example: 31/12/2569 14:30
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
