const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Token required' });
  try {
    req.user = jwt.verify(token, SECRET);
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

module.exports = { requireAuth, requireRole, SECRET };
