const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

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

const REBATE_ALL_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER'];
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
  requireRole,
  requireRebateAmountAccess,
  canViewAllRebateAmounts,
  canViewRebateAmounts,
  SECRET,
};
