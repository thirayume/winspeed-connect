/**
 * Utility for analyzing truck types based on license plate patterns and historical weights.
 * This aligns with Thai DOT regulations and logistics standards.
 */

export type TruckCategory = '4w' | '6w' | '10w' | 'trailer' | 'semi-trailer' | 'container' | 'unknown';

/**
 * Predicts the truck category based on plate pattern and historical max payload (Net Weight in kg).
 * 
 * General rules:
 * - Commercial plates often start with 70-79.
 * - Drawbar trailers (แม่-ลูก) often have two plates, sometimes joined by '/' or '-'.
 * - Weights:
 *    < 4,000 kg : 4-wheel (Pickup)
 *    4,000 - 8,000 kg : 6-wheel
 *    8,000 - 15,000 kg : 10-wheel
 *    > 15,000 kg : Trailer / Semi-Trailer
 */
export function predictTruckCategory(plate: string | undefined, maxHistoricalPayloadKg?: number): TruckCategory {
  if (!plate && !maxHistoricalPayloadKg) return '10w'; // Default

  const plateStr = (plate || '').trim();

  // 1. Check plate pattern for obvious trailers (e.g., contains '/' or 'พ่วง')
  if (plateStr.includes('/') || plateStr.includes('พ่วง')) {
    return 'trailer'; // Drawbar Trailer (แม่-ลูก)
  }

  // 2. If we have historical weight data, use it as the primary indicator
  if (maxHistoricalPayloadKg) {
    if (maxHistoricalPayloadKg > 28000) {
      // Extremely heavy -> Semi-trailer or heavy drawbar trailer.
      // If no '/' in plate, assume semi-trailer (รถเทรลเลอร์พื้นเรียบ)
      return 'semi-trailer';
    }
    if (maxHistoricalPayloadKg > 15000) {
      // Heavy -> Could be a lighter trailer or heavy 10w
      return '10w';
    }
    if (maxHistoricalPayloadKg > 4000 && maxHistoricalPayloadKg <= 8000) {
      // Light -> 6w
      return '6w';
    }
    if (maxHistoricalPayloadKg <= 4000) {
      // Very Light -> 4w (Pickup)
      return '4w';
    }
    return '10w'; // Default 8-15t
  }

  // 3. Fallback to basic plate heuristics if no weight data
  // Thai plate format: "70-1234 กทม"
  const prefixMatch = plateStr.match(/^(\d{2})/);
  if (prefixMatch) {
    const prefix = parseInt(prefixMatch[1], 10);
    // 77-79 are often used for trailers/heavy machinery in some regions
    if (prefix >= 77 && prefix <= 79) {
      return 'semi-trailer';
    }
  }

  return '10w'; // Safe default
}
