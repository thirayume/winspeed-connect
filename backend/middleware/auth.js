const { hasRole,hasPermission } = require('../services/role-capabilities');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';
const ADMIN_ACCOUNTING_DELEGATION = new Set(['credit.approve-native', 'invoice.post-native']);

function mayDelegateAccounting(actor, action) {
  return ADMIN_ACCOUNTING_DELEGATION.has(action) && hasRole(actor, 'ADMIN') && hasPermission(actor, 'access-as');
}

/** true if this role may switch its session database (capability database.switch). */
function maySwitchDatabase(role) {
  try {
    return typeof role==='object' ? hasPermission(role,'database.switch') : require('../services/role-capabilities').rolesFor('database.switch').includes(String(role || '').toUpperCase());
  } catch { return false; }
}

/** Run fn with the session's chosen database when the JWT carries a valid, still-permitted claim. */
function runWithSessionDatabase(payload, role, fn) {
  const wanted = payload && typeof payload.db === 'string' ? payload.db.trim() : '';
  if (!wanted) return fn();
  try {
    const { isSwitchableDb } = require('../onprem-target');
    if (maySwitchDatabase(role) && isSwitchableDb(wanted)) {
      return require('../db').runWithDb(wanted, fn);
    }
  } catch { /* fall through to the default database */ }
  return fn();
}

// Identity and permissions are anchored to the deployment's primary database,
// regardless of the system default or the session's business database.
function runOnIdentityDatabase(fn) {
  const db = require('../db');
  if (typeof db.getTarget !== 'function' || db.getTarget() !== 'onprem') return fn();
  const primary = require('../services/active-database').primaryDatabase();
  if (!primary) throw Object.assign(new Error('PRIMARY_DATABASE_REQUIRED'), { status: 503 });
  return db.runWithTarget('onprem', fn, primary);
}

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
 * A disabled or unverified account loses access at once, not when its 8-hour token runs out (UAT 2026-10-09, PERM-07, A01).
 * Verification is strictly fail-closed:
 * - Active account (IsActive === 1 or true): passes. Cached up to ACCOUNT_STATUS_TTL_MS (60s).
 * - Disabled account (IsActive === 0 or false): 401 code ACCOUNT_DISABLED. Cached up to 60s.
 * - Missing/deleted account: 401 code ACCOUNT_NOT_FOUND. Cached up to 60s.
 * - Invalid/malformed account ID: 401 code INVALID_TOKEN.
 * - Database lookup error: 503 code SERVICE_UNAVAILABLE (fail-closed, NOT cached to allow immediate recovery).
 *
 * Cache TTL is 60 seconds. User admin routes clear the cache immediately via clearAccountStatusCache().
 * Direct database updates performed outside the application take effect once the 60s TTL expires.
 */
const ACCOUNT_STATUS_TTL_MS = 60 * 1000;
const accountStatusCache = new Map();

async function checkAccountStatus(id) {
  const key = Number(id);
  if (!Number.isInteger(key) || key <= 0) {
    return { ok: false, status: 'INVALID', code: 'INVALID_TOKEN', message: 'รหัสผู้ใช้ไม่ถูกต้อง' };
  }
  const db = require('../db');
  const cacheKey = JSON.stringify([db.getTarget?.() || '', db.getDbName?.() || '', key]);
  const hit = accountStatusCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ACCOUNT_STATUS_TTL_MS) {
    return hit;
  }
  try {
    const { wfQuery, sql } = require('../db');
    const r = await wfQuery('SELECT IsActive FROM wf.AppUser WHERE Id = @id', { id: { type: sql.Int, value: key } });
    const row = r?.recordset?.[0];
    if (!row) {
      const res = { ok: false, status: 'NOT_FOUND', code: 'ACCOUNT_NOT_FOUND', message: 'ไม่พบบัญชีผู้ใช้ในระบบ', at: Date.now() };
      accountStatusCache.set(cacheKey, { ...res, id: key });
      return res;
    }
    const isActive = row.IsActive === true || row.IsActive === 1;
    if (!isActive) {
      const res = { ok: false, status: 'DISABLED', code: 'ACCOUNT_DISABLED', message: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ', at: Date.now() };
      accountStatusCache.set(cacheKey, { ...res, id: key });
      return res;
    }
    const res = { ok: true, status: 'ACTIVE', at: Date.now() };
    accountStatusCache.set(cacheKey, { ...res, id: key });
    return res;
  } catch {
    // Fail-closed without caching so retry succeeds immediately after DB recovery
    return { ok: false, status: 'ERROR', code: 'SERVICE_UNAVAILABLE', message: 'ไม่สามารถตรวจสอบสถานะบัญชีผู้ใช้ได้ชั่วคราว' };
  }
}

function clearAccountStatusCache(id) {
  if (id === undefined || id === null) accountStatusCache.clear();
  else for (const [key, entry] of accountStatusCache) if (entry.id === Number(id)) accountStatusCache.delete(key);
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Token required' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.tokenPayload = payload; // raw verified claims, for re-issuing on a database switch
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
      // A verified token is still an identity claim, not proof of a reviewed
      // cross-database binding. Only middleware may attach a fresh mapping.
      identityMapping: undefined,
      isImpersonating: Boolean(payload.impersonating || Number(actorId) !== Number(effectiveId)),
    };
    if (blockWriteWhenPasswordStale(req, res)) return;
  } catch {
    return res.status(401).json({ message: 'Token invalid or expired' });
  }
  const { actorId, effectiveId } = req.user;
  const identityStatus = async id => {
    try { return await runOnIdentityDatabase(() => checkAccountStatus(id)); }
    catch { return { status: 'ERROR' }; }
  };
  Promise.all([
    identityStatus(actorId),
    Number(actorId) !== Number(effectiveId) ? identityStatus(effectiveId) : Promise.resolve(null),
  ]).then(([actorStatus, effectiveStatus]) => {
    if (actorStatus.status === 'ERROR' || effectiveStatus?.status === 'ERROR') {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'ไม่สามารถตรวจสอบสถานะบัญชีผู้ใช้ได้ชั่วคราว' });
    }
    if (!actorStatus.ok) {
      return res.status(401).json({ code: actorStatus.code, message: actorStatus.message });
    }
    if (effectiveStatus && !effectiveStatus.ok) {
      return res.status(401).json({ code: effectiveStatus.code, message: effectiveStatus.message });
    }
    // R12 item 4: audit writers read the Access As actor from this request context
    const run = async () => {
      try {
        const activeDb = require('../services/active-database');
        // Control endpoints remain available to recover a session after access is revoked.
        const controlRoute = String(req.baseUrl || '') === '/api/auth' && ['/databases','/switch-database','/me','/logout'].includes(req.path);
        if (activeDb.onpremEnabled() && !controlRoute) {
          const database = require('../db').getDbName() || await activeDb.systemActiveDatabase();
          req.auditBusinessDatabase = database;
          const primary = activeDb.primaryDatabase();
          if (!primary) throw Object.assign(new Error('PRIMARY_DATABASE_REQUIRED'), { status: 503 });
          let themes = {};
          try {
            themes = await activeDb.getDatabaseThemes();
          } catch {
            themes = activeDb.DEFAULT_DATABASE_THEMES;
          }
          if (!activeDb.canAccessDatabase(database, req.user, themes)) return res.status(403).json({ code: 'DB_RESTRICTED', message: 'บทบาทนี้ไม่มีสิทธิ์เข้าถึงฐานข้อมูลที่เลือก กรุณาสลับฐานข้อมูล' });
          if (database.toLowerCase() !== primary.toLowerCase()) {
            // The list and stats are read-only and use the target scope and
            // data cutoff. Other routes stay closed until individually reviewed.
            const reviewedRead = req.method === 'GET' && req.baseUrl === '/api/so' && ['/', '/stats'].includes(req.path) &&
              hasRole(req.user, 'ADMIN', 'C_LEVEL', 'ACCOUNTING');
            if (!reviewedRead) return res.status(409).json({ code: 'IDENTITY_MAPPING_REQUIRED', message: 'กรุณากลับฐานหลัก หรือตรวจสอบการจับคู่บัญชีระหว่างฐานก่อนใช้งานฐานนี้' });
            const actor = req.user.isImpersonating ? {
              role: req.user.actorRole, roles: req.user.actorRoles, permissions: req.user.actorPermissions,
            } : req.user;
            if (!activeDb.canAccessDatabase(database, actor, themes)) return res.status(403).json({ code: 'DB_RESTRICTED' });
            const identity = require('../services/database-identity-resolver');
            let mapping;
            try {
              mapping = await identity.resolveReviewedActorAndEffective({
                actorUserId: Number(req.user.actorSub), effectiveUserId: Number(req.user.sub),
                primaryDatabase: primary, targetDatabase: database,
              }, identity.sqlRepository(require('../db'), require('../onprem-target').isSwitchableDb));
            } catch (e) {
              if (e.code === 'IDENTITY_BINDING_INVALID') return res.status(409).json({ code: 'IDENTITY_MAPPING_REQUIRED' });
              throw e;
            }
            req.user.identityMapping = mapping;
            req.identityMappingAudit = mapping;
          }
        }
        if (activeDb.onpremEnabled() && !req.auditBusinessDatabase) {
          req.auditBusinessDatabase = require('../db').getDbName() || await activeDb.systemActiveDatabase();
        }
        if (blockWriteWhenPasswordStale(req,res)) return;
        require('../services/request-context').runWithUser(req.user, () => next());
      } catch(e) {if(process.env.NODE_ENV!=='production')console.error('[auth error]',e);res.status(e.status||503).json({code:e.status===401?'SESSION_REVOKED':'ROLE_UNAVAILABLE',message:'สิทธิ์หรือข้อมูลเข้าสู่ระบบเปลี่ยน กรุณาเข้าสู่ระบบใหม่'});}
    };
    // Database switching (owner 2026-10-25): a permitted role's session may point at another
    // allowed database, carried in the JWT `db` claim. An invalid or no-longer-permitted claim is
    // ignored and the request falls back to the system default already set by the DB-target
    // middleware. The migrator and non-onprem targets never switch.
    // Auth Anchor (PROD_DB): Identity, credentials, and roles are always resolved against the primary DB.
    const prepare = async () => {
      try {
        const { sessionProfile } = require('../services/role-profiles');
        req.user = await runOnIdentityDatabase(() => sessionProfile(req.user, req.tokenPayload));
        if (Number(actorId) !== Number(effectiveId)) {
          const actor = await runOnIdentityDatabase(() => sessionProfile(
            { ...req.user, id: actorId, role: req.tokenPayload.actorRole || req.user.role, roles: undefined, permissions: undefined },
            { authVersion: req.tokenPayload.actorAuthVersion || 0 }
          ));
          if (!hasPermission(actor, 'access-as')) throw Object.assign(new Error('ACCESS_AS_REVOKED'), { status: 403 });
          if (req.user.permissions && actor.permissions) {
            req.user.permissions = req.user.permissions.filter(k => actor.permissions.includes(k) || mayDelegateAccounting(actor, k));
          }
          req.user.actorRoles = actor.roles;
          req.user.actorPermissions = actor.permissions;
          req.user.actorDisabledActions = actor.disabledActions;
          req.user.disabledActions = [...new Set([...(req.user.disabledActions || []), ...(actor.disabledActions || [])])];
          req.user.mustChangePassword = actor.mustChangePassword;
        }

        const isAuthOrAdminRoute = String(req.baseUrl || '').startsWith('/api/auth') || String(req.baseUrl || '').startsWith('/api/admin-management');
        const actorForSwitch = req.user.isImpersonating
          ? { role: req.user.actorRole, roles: req.user.actorRoles, permissions: req.user.actorPermissions }
          : req.user;

        if (req.tokenPayload.db && !isAuthOrAdminRoute && maySwitchDatabase(req.user) && maySwitchDatabase(actorForSwitch)) {
          return runWithSessionDatabase(req.tokenPayload, actorForSwitch, run);
        }
        return run();
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.error('[auth error]', e);
        return res.status(e.status || 503).json({
          code: e.status === 401 ? 'SESSION_REVOKED' : 'ROLE_UNAVAILABLE',
          message: 'สิทธิ์หรือข้อมูลเข้าสู่ระบบเปลี่ยน กรุณาเข้าสู่ระบบใหม่',
        });
      }
    };
    return prepare();
  }).catch(next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user;
    const actor = user?.isImpersonating ? { role: user.actorRole, roles: user.actorRoles } : user;
    // Acting as another user must not grant either party a role they do not
    // possess. Each may qualify through any one of their assigned roles.
    if (!hasRole(user,...roles) || !hasRole(actor,...roles))
      return res.status(403).json({ message: `ต้องการสิทธิ์: ${roles.join(' / ')}` });
    next();
  };
}

// R12 item 3: guard a route with a capability from services/role-capabilities.js
function requireCapability(action) {
  return (req,res,next) => {
    const actor = req.user?.isImpersonating ? {
      role: req.user.actorRole, roles: req.user.actorRoles,
      permissions: req.user.actorPermissions, disabledActions: req.user.actorDisabledActions,
    } : req.user;
    const subject = action === 'access-as' ? actor : req.user;
    if (!hasPermission(subject,action) || (req.user?.isImpersonating && action !== 'access-as' && !hasPermission(actor,action) && !mayDelegateAccounting(actor,action))) {
      return res.status(403).json({message:'Role นี้ไม่ได้รับ Permission สำหรับงานนี้'});
    }
    next();
  };
}

// Owner 2026-10-09: a salesperson sees no rebate amount anywhere, on bills (D1) or on the rebate page. SALES keeps the
// rebate page for their own pools, claims and delivery lots, with every baht figure removed (hideRebateMoneyFromSales).
const REBATE_ALL_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'C_LEVEL'];
const REBATE_OWN_ROLES = ['SALES', 'COUNTER_SALES'];

function canViewAllRebateAmounts(user) {
  return hasRole(user,...REBATE_ALL_ROLES);
}

function canViewRebateAmounts(user) {
  return canViewAllRebateAmounts(user);
}

function requireRebateAmountAccess(req, res, next) {
  const actor = req.user?.isImpersonating ? { role: req.user.actorRole, roles: req.user.actorRoles } : req.user;
  if (!canViewRebateAmounts(req.user) || !canViewRebateAmounts(actor)) {
    return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูตัวเลขรีเบท' });
  }
  next();
}

/** the rebate page: everyone who sees amounts, plus a salesperson for their own records (amounts removed) */
function requireRebatePageAccess(req, res, next) {
  if (!hasRole(req.user,...REBATE_ALL_ROLES,...REBATE_OWN_ROLES)) {
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
