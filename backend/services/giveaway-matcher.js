/**
 * giveaway-matcher.js
 *
 * Canonical giveaway item and brand matching service (U-4, U-7, U-8).
 * Used across:
 * 1. Quota display (GET /api/master/giveaway-goods, GET /api/giveaway/my-quota)
 * 2. Add check (CreateSODialog)
 * 3. Server quota validation on save/approval (POST/PUT /api/so, POST /api/so/:id/approve-giveaway)
 * 4. Auto-withdrawal on confirmation (draft-confirmation.js)
 */

const KNOWN_BRANDS = ['รถเกษตร', 'ปุ๋ยเทพ'];

function normalizeText(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/\s+/g, ' ');
}

function isNumericString(str) {
  return /^\d+$/.test(String(str || '').trim());
}

function normalizeBrand(str) {
  const b = normalizeText(str);
  if (!b || isNumericString(b)) return '';
  if (b === 'ตรารถเกษตร' || b.includes('รถเกษตร')) return 'รถเกษตร';
  if (b === 'ตราปุ๋ยเทพ' || b.includes('ปุ๋ยเทพ')) return 'ปุ๋ยเทพ';
  if (b === 'ส่วนกลาง' || b === 'ทั่วไป' || b === 'ของแถม') return 'ทั่วไป';
  return b;
}

/**
 * Extract canonical Brand from good / mapping info
 */
function resolveBrand(good = {}) {
  const explicitBrand = normalizeBrand(good.Brand || good.brand);
  if (explicitBrand && KNOWN_BRANDS.includes(explicitBrand)) {
    return explicitBrand;
  }

  const name = normalizeText(good.GoodName || good.goodName || good.GoodName1 || good.ItemName || good.itemName);
  if (name.includes('ปุ๋ยเทพ')) return 'ปุ๋ยเทพ';
  if (name.includes('รถเกษตร')) return 'รถเกษตร';

  if (explicitBrand && explicitBrand !== 'ทั่วไป') {
    return explicitBrand;
  }
  return 'ทั่วไป';
}

/**
 * Extract canonical ItemName matching budget lines (e.g. "16-8-8", "เสื้อยืดแขนยาว", etc.)
 */
function resolveItemName(good = {}) {
  const explicitItem = normalizeText(good.ItemName || good.itemName);
  // If explicitItem is a formula or valid merchandise name and not just a brand name
  if (explicitItem && !KNOWN_BRANDS.includes(explicitItem) && !isNumericString(explicitItem)) {
    // Check if it's already a formula
    const fMatch = explicitItem.match(/(\d+-\d+-\d+)/);
    if (fMatch) return fMatch[1];
    return explicitItem;
  }

  const name = normalizeText(good.GoodName || good.goodName || good.GoodName1);
  if (!name) return explicitItem || '';

  // 1. Check for N-P-K chemical formula (e.g., 16-8-8, 15-3-3, 0-0-60)
  const formulaMatch = name.match(/(\d+-\d+-\d+)/);
  if (formulaMatch) {
    return formulaMatch[1];
  }

  // 2. Check for known merchandise categories in budget
  if (name.includes('เสื้อยืดแขนยาว')) return 'เสื้อยืดแขนยาว';
  if (name.includes('เสื้อยืดคอกลม')) return 'เสื้อยืดคอกลม';
  if (name.includes('เสื้อโปโล')) return 'เสื้อโปโล';
  if (name.includes('กระเป๋าใบใหญ่')) return 'กระเป๋าใบใหญ่';
  if (name.includes('กระเป๋า')) return 'กระเป๋า';
  if (name.includes('แบนเนอร์ รถเกษตร') || name.includes('แบนเนอร์ตรารถเกษตร')) return 'แบนเนอร์ รถเกษตร';
  if (name.includes('แบนเนอร์ ปุ๋ยเทพ') || name.includes('แบนเนอร์ตราปุ๋ยเทพ')) return 'แบนเนอร์ ปุ๋ยเทพ';
  if (name.includes('โบว์ชัวส์ ยางพารา') || name.includes('โบรชัวร์ ยางพารา')) return 'โบว์ชัวส์ ยางพารา';
  if (name.includes('เต็นท์พับได้')) return 'เต็นท์พับได้';
  if (name.includes('PP board') || name.includes('PP Board')) return 'PP board';
  if (name.includes('ผ้าใบชักลอก')) return 'ผ้าใบชักลอก';

  // Strip brand prefixes if any
  let cleanName = name
    .replace(/^ตรารถเกษตร\s*/, '')
    .replace(/^ตราปุ๋ยเทพ\s*/, '')
    .replace(/\s*ตรารถเกษตร\s*$/, '')
    .replace(/\s*ตราปุ๋ยเทพ\s*$/, '')
    .trim();

  return cleanName || name;
}

/**
 * Master resolution function
 * Returns canonical { brand, itemName }
 */
function matchGiveawayItem(good = {}) {
  const brand = resolveBrand(good);
  const itemName = resolveItemName(good);
  return { brand, itemName };
}

/**
 * Check if a giveaway line matches a quota budget line
 */
function isGiveawayQuotaMatch(line = {}, quota = {}) {
  const lineGoodId = line.goodId ?? line.GoodId ?? line.GoodID;
  const quotaGoodId = quota.GoodId ?? quota.goodId ?? quota.GoodID;
  if (lineGoodId != null && quotaGoodId != null && String(lineGoodId).trim() !== '' && String(quotaGoodId).trim() !== '') {
    return String(lineGoodId).trim() === String(quotaGoodId).trim();
  }

  const lineMatched = matchGiveawayItem(line);
  const quotaBrand = normalizeBrand(quota.Brand || quota.brand) || 'ทั่วไป';
  const quotaItem = normalizeText(quota.ItemName || quota.itemName);

  // Brand match (if quota has a brand, must match unless general)
  if (quotaBrand && quotaBrand !== 'ทั่วไป' && lineMatched.brand !== 'ทั่วไป') {
    if (quotaBrand !== lineMatched.brand) return false;
  }

  // ItemName match
  if (quotaItem && quotaItem === lineMatched.itemName) return true;

  // Formula match
  const qFormula = quotaItem.match(/(\d+-\d+-\d+)/);
  const lFormula = lineMatched.itemName.match(/(\d+-\d+-\d+)/);
  if (qFormula && lFormula && qFormula[1] === lFormula[1]) {
    return true;
  }

  // Substring match for merchandise if both brands match
  if (quotaBrand === lineMatched.brand && quotaItem && lineMatched.itemName) {
    if (quotaItem.includes(lineMatched.itemName) || lineMatched.itemName.includes(quotaItem)) {
      return true;
    }
  }

  return false;
}

/**
 * Find matching quota row from an array of quota rows.
 * Prioritizes direct GoodId matches over legacy Brand+ItemName heuristics.
 */
function findMatchingQuota(line = {}, quotaList = []) {
  if (!Array.isArray(quotaList) || quotaList.length === 0) return null;
  const lineGoodId = line.goodId ?? line.GoodId ?? line.GoodID;
  if (lineGoodId != null && String(lineGoodId).trim() !== '') {
    const exactByGoodId = quotaList.find(q => {
      const qGid = q.GoodId ?? q.goodId ?? q.GoodID;
      return qGid != null && String(qGid).trim() === String(lineGoodId).trim();
    });
    if (exactByGoodId) return exactByGoodId;
  }
  return quotaList.find(q => isGiveawayQuotaMatch(line, q)) || null;
}

module.exports = {
  KNOWN_BRANDS,
  normalizeText,
  normalizeBrand,
  resolveBrand,
  resolveItemName,
  matchGiveawayItem,
  isGiveawayQuotaMatch,
  findMatchingQuota
};
