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
    next();
  } catch {
    res.status(401).json({ message: 'Token invalid or expired' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ message: `ต้องการสิทธิ์: ${roles.join(' / ')}` });
    next();
  };
}

const REBATE_ALL_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'C_LEVEL'];
const REBATE_OWN_ROLES = ['SALES'];
const REBATE_AMOUNT_ROLES = [...REBATE_ALL_ROLES, ...REBATE_OWN_ROLES];

function canViewAllRebateAmounts(user) {
  return REBATE_ALL_ROLES.includes(user?.role);
}

function canViewRebateAmounts(user) {
  return REBATE_AMOUNT_ROLES.includes(user?.role);
}

function requireRebateAmountAccess(req, res, next) {
  if (!canViewRebateAmounts(req.user)) {
    return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูตัวเลขรีเบท' });
  }
  next();
}

module.exports = {
  requireAuth,
  blockWriteWhenPasswordStale,
  passwordChangeEnforced,
  requireRole,
  requireRebateAmountAccess,
  canViewAllRebateAmounts,
  canViewRebateAmounts,
  SECRET,
};
