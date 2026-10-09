const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

/**
 * D6-02 — บัญชีที่ยังใช้รหัสผ่านตั้งต้นร่วมกับคนอื่น ห้ามเขียนข้อมูล
 *
 * ทั้งรุ่น 1.6.0 สร้างขึ้นเพื่อให้ลายเซ็นอนุมัติ 4 ชั้นพิสูจน์ตัวบุคคลได้
 * ถ้ารหัสผ่านยังใช้ร่วมกัน ชื่อผู้อนุมัติในหลักฐานไม่ได้พิสูจน์ว่าใครทำจริง
 * แถบเตือนบนหน้าจอไม่ได้ลดความเสี่ยงลงเลย เพียงย้ายว่าใครรับผิดเท่านั้น
 *
 * บล็อกเฉพาะคำสั่งที่เขียน ไม่บล็อกการอ่าน — คนที่กำลังทำงานค้างอยู่ยังเปิดดู
 * งานตัวเองได้ระหว่างถูกผลักให้เปลี่ยนรหัส การตัดทุก request จะทำให้งานที่
 * กรอกค้างไว้หายและกลายเป็นการหยุดทั้งแผนกในวันที่เปิดใช้
 *
 * ยกเว้น /api/auth ทั้งชุด มิฉะนั้นผู้ใช้จะเปลี่ยนรหัสผ่านไม่ได้เลย
 * เพราะ endpoint เปลี่ยนรหัสผ่านเองก็เป็น PUT
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * เปิดใช้เฉพาะเครื่องที่ deploy จริง — ตั้ง ENFORCE_PASSWORD_CHANGE=true ใน .env ของเซิร์ฟเวอร์
 *
 * บนเครื่องนักพัฒนา บัญชีทดสอบใช้รหัสผ่านร่วมกันโดยเจตนาและไม่มีใครเปลี่ยน
 * ถ้าบังคับด้วย งานพัฒนาและการเดินชุดทดสอบจะติดขัดโดยไม่ได้ลดความเสี่ยงจริงลงเลย
 * เพราะความเสี่ยงอยู่ที่ฐานของโรงงาน ไม่ใช่ฐานบนเครื่องตัวเอง
 *
 * ค่าปริยายคือปิด — เปิดโดยตั้งใจเท่านั้น ไม่ใช่เปิดเพราะเผลอ
 */
function passwordChangeEnforced() {
  return String(process.env.ENFORCE_PASSWORD_CHANGE || '').toLowerCase() === 'true';
}

function blockWriteWhenPasswordStale(req, res) {
  if (!passwordChangeEnforced()) return false;
  if (!req.user?.mustChangePassword) return false;
  if (!WRITE_METHODS.has(req.method)) return false;
  if (String(req.baseUrl || '').startsWith('/api/auth')) return false;

  res.status(403).json({
    code: 'PASSWORD_CHANGE_REQUIRED',
    message: 'บัญชีนี้ยังใช้รหัสผ่านตั้งต้นที่ซ้ำกับผู้ใช้อื่น '
           + 'กรุณาเปลี่ยนรหัสผ่านที่หน้าโปรไฟล์ก่อนจึงจะบันทึกข้อมูลได้',
  });
  return true;
}

/**
 * A disabled account loses access at once, not when its 8-hour token runs out (UAT 2026-10-09, PERM-07: login
 * refused a disabled user, but a token issued before kept working). The flag is read per user at most once a minute
 * and the user admin route clears it on change. Only a row that exists with IsActive = 0 blocks; a lookup error
 * lets the request through (login itself checks the flag) and is not cached.
 */
const ACCOUNT_STATUS_TTL_MS = 60 * 1000;
const accountStatusCache = new Map();
async function accountDisabled(id) {
  const key = Number(id);
  if (!Number.isInteger(key) || key <= 0) return false;
  const hit = accountStatusCache.get(key);
  if (hit && Date.now() - hit.at < ACCOUNT_STATUS_TTL_MS) return hit.disabled;
  try {
    const { wfQuery, sql } = require('../db');
    const r = await wfQuery('SELECT IsActive FROM wf.AppUser WHERE Id = @id', { id: { type: sql.Int, value: key } });
    const row = r?.recordset?.[0];
    const disabled = !!row && (row.IsActive === false || row.IsActive === 0);
    accountStatusCache.set(key, { disabled, at: Date.now() });
    return disabled;
  } catch {
    return false;
  }
}
function clearAccountStatusCache(id) {
  if (id === undefined || id === null) accountStatusCache.clear();
  else accountStatusCache.delete(Number(id));
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Token required' });
  try {
    const payload = jwt.verify(token, SECRET);
    const effectiveId = payload.sub || payload.id;
    const actorId = payload.actorSub || payload.actorId || effectiveId;
    req.user = {
      ...payload,
      sub: effectiveId,
      id: effectiveId,
      actorSub: actorId,
      actorId,
      effectiveSub: effectiveId,
      effectiveId,
      isImpersonating: Boolean(payload.impersonating || Number(actorId) !== Number(effectiveId)),
    };
    if (blockWriteWhenPasswordStale(req, res)) return;
  } catch {
    return res.status(401).json({ message: 'Token invalid or expired' });
  }
  const { actorId, effectiveId } = req.user;
  Promise.all([
    accountDisabled(actorId),
    Number(actorId) !== Number(effectiveId) ? accountDisabled(effectiveId) : Promise.resolve(false),
  ]).then(([actorOff, effectiveOff]) => {
    if (actorOff || effectiveOff) {
      return res.status(401).json({ code: 'ACCOUNT_DISABLED', message: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
    }
    // R12 item 4: audit writers read the Access As actor from this request context
    require('../services/request-context').runWithUser(req.user, () => next());
  }).catch(next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ message: `ต้องการสิทธิ์: ${roles.join(' / ')}` });
    next();
  };
}

// R12 item 3: guard a route with a capability from services/role-capabilities.js
function requireCapability(action) {
  const { rolesFor } = require('../services/role-capabilities');
  return requireRole(...rolesFor(action));
}

// Owner 2026-10-09: a salesperson sees no rebate amount anywhere, on bills (D1) or on the rebate page. SALES keeps the
// rebate page for their own pools, claims and delivery lots, with every baht figure removed (hideRebateMoneyFromSales).
const REBATE_ALL_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'C_LEVEL'];
const REBATE_OWN_ROLES = ['SALES'];

function canViewAllRebateAmounts(user) {
  return REBATE_ALL_ROLES.includes(user?.role);
}

function canViewRebateAmounts(user) {
  return canViewAllRebateAmounts(user);
}

function requireRebateAmountAccess(req, res, next) {
  if (!canViewRebateAmounts(req.user)) {
    return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูตัวเลขรีเบท' });
  }
  next();
}

/** the rebate page: everyone who sees amounts, plus a salesperson for their own records (amounts removed) */
function requireRebatePageAccess(req, res, next) {
  if (![...REBATE_ALL_ROLES, ...REBATE_OWN_ROLES].includes(req.user?.role)) {
    return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูข้อมูลรีเบท' });
  }
  next();
}

// money columns of the rebate tables and views: AccruedAmt, ClaimAmt, CustomerAmount, LineAmount, PricePerTon,
// NetPricePerTon, RebatePerTon, NetPrice, GoodPrice … Tons (QtyTon, RemainingTon) and ratios stay.
const REBATE_MONEY_KEY = /(Amt|Amount|PerTon|Price)$/i;

function redactRebateMoney(value) {
  if (Array.isArray(value)) return value.map(redactRebateMoney);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = REBATE_MONEY_KEY.test(k) ? null : redactRebateMoney(v);
  return out;
}

/** strips every money field from a successful JSON answer when the caller may not see rebate amounts */
function hideRebateMoneyFromSales(req, res, next) {
  if (canViewRebateAmounts(req.user)) return next();
  const json = res.json.bind(res);
  res.json = body => json(res.statusCode >= 400 ? body : redactRebateMoney(body));
  next();
}

module.exports = {
  requireAuth,
  blockWriteWhenPasswordStale,
  passwordChangeEnforced,
  requireRole,
  requireCapability,
  requireRebateAmountAccess,
  requireRebatePageAccess,
  hideRebateMoneyFromSales,
  redactRebateMoney,
  canViewAllRebateAmounts,
  canViewRebateAmounts,
  SECRET,
  clearAccountStatusCache,
};
