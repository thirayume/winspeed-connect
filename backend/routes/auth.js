const {hasPermission} = require('../services/role-capabilities');
const roleWrite=require('../services/role-policy-write');
const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sql, wfQuery, wfTransaction } = require('../db');
const { ensureRebateDocCode } = require('../services/rebate-doc-code');

/** best effort: the user is saved either way, and the code is given again on first use */
async function giveRebateDocCode(userId) {
  if (!userId) return;
  try { await ensureRebateDocCode(userId); } catch (e) { console.error('[rebate-doc-code]', e.message); }
}
const { requireAuth, requireRole, requireCapability, passwordChangeEnforced, SECRET, clearAccountStatusCache } = require('../middleware/auth');

const upload = multer({
  storage: multer.diskStorage({
    // the folder is not in the repository: a fresh server (or an empty Docker volume) has to create it
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../uploads/signatures');
      fs.mkdir(dir, { recursive: true }, err => cb(err, dir));
    },
    filename: (req, file, cb) => cb(null, `sig_${req.user.sub}_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const LINE_AUTH_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';

// R12 item 1/3: ranks and Access As actors come from the shared role-capability map
const { ROLE_RANK: ACCESS_AS_ROLE_RANK, ACCESS_AS_ACTOR_ROLES: ACTOR_ROLE_LIST, capabilitiesFor, rolesFor, userRoles, hasRole } = require('../services/role-capabilities');
const activeDb = require('../services/active-database');
const { getDbName } = require('../db');
const roleHasCapability = (role, cap) => rolesFor(cap).includes(String(role || '').toUpperCase());
/** re-sign the current session with a different database claim, preserving the token's lifetime */
function reissueWithDatabase(tokenPayload, database) {
  const { iat, ...rest } = tokenPayload || {}; // keep exp so switching never extends the session
  if (database) rest.db = database; else delete rest.db;
  return jwt.sign(rest, SECRET);
}
const ACCESS_AS_ACTOR_ROLES = new Set(ACTOR_ROLE_LIST);

function getUserId(user) {
  return Number(user?.Id ?? user?.id ?? user?.sub);
}

function getUserRole(user) {
  return String(user?.Role ?? user?.role ?? '').toUpperCase();
}

function roleRank(role) {
  return ACCESS_AS_ROLE_RANK[String(role || '').toUpperCase()] || 0;
}

function canUseAccessAs(role) {
  return ACCESS_AS_ACTOR_ROLES.has(String(role || '').toUpperCase());
}

function canAccessAs(actorRole, targetRole) {
  const actorRank = roleRank(actorRole);
  const targetRank = roleRank(targetRole);
  return actorRank > 0 && targetRank > 0 && actorRank >= targetRank;
}

function toClientUser(user, actor = null) {
  const effectiveId = getUserId(user);
  const actorId = actor ? getUserId(actor) : effectiveId;
  const isImpersonating = actorId && effectiveId && Number(actorId) !== Number(effectiveId);
  const out = {
    id: effectiveId,
    username: user.Username ?? user.username,
    displayName: user.DisplayName ?? user.displayName,
    role: getUserRole(user),
    roleCode: user.RoleCode || user.Role,
    authVersion: user.AuthVersion || 0,
    empId: user.EmpId ?? user.empId ?? null,
    isActive: user.IsActive === undefined ? true : Boolean(user.IsActive),
    address: user.Address ?? user.address ?? null,
    phone: user.Phone ?? user.phone ?? null,
    email: user.Email ?? user.email ?? null,
    idCardNo: user.IdCardNo ?? user.idCardNo ?? null,
    taxId: user.TaxId ?? user.taxId ?? null,
    signatureFile: user.SignatureFile ?? user.signatureFile ?? null,
    lineUserId: user.LineUserId ?? user.lineUserId ?? null,
    lineDisplayName: user.LineDisplayName ?? user.lineDisplayName ?? null,
    lineLinkedAt: user.LineLinkedAt ?? user.lineLinkedAt ?? null,
    actorId,
    actorUsername: actor ? (actor.Username ?? actor.username) : (user.Username ?? user.username),
    actorDisplayName: actor ? (actor.DisplayName ?? actor.displayName) : (user.DisplayName ?? user.displayName),
    actorRole: actor ? getUserRole(actor) : getUserRole(user),
    isImpersonating,
    // R12 item 3: menus and key actions of the effective role (frontend hides what the API refuses)
    capabilities: capabilitiesFor(getUserRole(user), { positionCode: user.PositionCode ?? user.positionCode ?? null }),
    // บอกหน้าจอเฉพาะเมื่อเซิร์ฟเวอร์บังคับจริง — บนเครื่องนักพัฒนาจะไม่ขึ้นหน้าบังคับ
    // เปลี่ยนรหัสมากั้นงาน ทั้งที่ธงในฐานข้อมูลยังอยู่ตามเดิม
    // ตอน Access As ใช้ธงของคนที่เข้าระบบจริง เหมือนใน token ไม่อย่างนั้นผู้ดูแล
    // จะติดอยู่หน้าเปลี่ยนรหัสของบัญชีปลายทางที่เขาไม่รู้รหัส และไม่มีปุ่มกลับ
    mustChangePassword: passwordChangeEnforced()
      && Boolean(actor
        ? (actor.MustChangePassword ?? actor.mustChangePassword)
        : (user.MustChangePassword ?? user.mustChangePassword)),
  };
  return out;
}

function appUserPayload(user, actor = null) {
  const effective = toClientUser(user, actor);
  return {
    sub: effective.id,
    id: effective.id,
    username: effective.username,
    role: effective.role,
    displayName: effective.displayName,
    actorSub: effective.actorId,
    actorId: effective.actorId,
    actorUsername: effective.actorUsername,
    actorRole: effective.actorRole,
    actorDisplayName: effective.actorDisplayName,
    impersonating: effective.isImpersonating,
    // ธงของ "บัญชีที่ใช้เข้าระบบจริง" ไม่ใช่บัญชีที่ถูกสวมสิทธิ์ — ตอน Access As
    // คนที่ยืนยันตัวตนคือผู้ดูแล ถ้าเขาเปลี่ยนรหัสแล้วก็ไม่ควรถูกบล็อกเพราะ
    // บัญชีปลายทางยังไม่เปลี่ยน (middleware/auth.js ใช้ค่านี้กันการเขียน)
    mustChangePassword: actor
      ? Boolean(actor.MustChangePassword ?? actor.mustChangePassword)
      : effective.mustChangePassword,
  };
}

function signAppToken(user, actor = null) {
  return jwt.sign({...appUserPayload(user, actor), authVersion:user.AuthVersion ?? 0, actorAuthVersion:actor?.AuthVersion ?? user.AuthVersion ?? 0}, SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

async function loadAppUserById(id) {
  const rows = await wfQuery(
    `SELECT Id, Username, DisplayName, Role, RoleCode, AuthVersion, EmpId, IsActive, MustChangePassword, PositionCode,
            Address, Phone, Email, IdCardNo, TaxId, SignatureFile,
            LineUserId, LineDisplayName, LineLinkedAt
     FROM wf.AppUser
     WHERE Id = @id`,
    { id: { type: sql.Int, value: Number(id) } }
  );
  return rows.recordset?.[0] || null;
}

async function recordAccessAsAudit(actorId, effectiveId, action, req) {
  try {
    await wfQuery(
      `IF OBJECT_ID('wf.AccessAsAudit', 'U') IS NOT NULL
       BEGIN
         EXEC sp_executesql
           N'INSERT INTO wf.AccessAsAudit (ActorUserId, EffectiveUserId, Action, IpAddress, UserAgent, CreatedAt)
             VALUES (@actorUserId, @effectiveUserId, @action, @ipAddress, @userAgent, SYSUTCDATETIME())',
           N'@actorUserId int, @effectiveUserId int, @action nvarchar(20), @ipAddress nvarchar(80), @userAgent nvarchar(500)',
           @actorUserId=@actorUserId, @effectiveUserId=@effectiveUserId, @action=@action, @ipAddress=@ipAddress, @userAgent=@userAgent;
       END`,
      {
        actorUserId: { type: sql.Int, value: Number(actorId) },
        effectiveUserId: { type: sql.Int, value: Number(effectiveId) },
        action: { type: sql.NVarChar(20), value: action },
        ipAddress: { type: sql.NVarChar(80), value: req.ip || null },
        userAgent: { type: sql.NVarChar(500), value: req.get('user-agent') || null },
      }
    );
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[access-as-audit]', e.message);
  }
}

async function closeOpenAccessAsSession(actorId, req) {
  try {
    const last = (await wfQuery(
      `IF OBJECT_ID('wf.AccessAsAudit', 'U') IS NOT NULL
         SELECT TOP 1 EffectiveUserId, Action FROM wf.AccessAsAudit WHERE ActorUserId = @a ORDER BY Id DESC`,
      { a: { type: sql.Int, value: Number(actorId) } }
    )).recordset?.[0];
    if (last && String(last.Action).toUpperCase() === 'START') {
      await recordAccessAsAudit(actorId, last.EffectiveUserId, 'STOP', req);
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[access-as-close]', e.message);
  }
}

function signLineLinkToken(profile) {
  return jwt.sign({
    purpose: 'line-link',
    lineUserId: profile.userId,
    lineDisplayName: profile.displayName || null,
    linePictureUrl: profile.pictureUrl || null,
  }, SECRET, { expiresIn: '10m' });
}

function verifyLineLinkToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    throw Object.assign(new Error('invalid LINE link token'), { status: 400 });
  }
  if (payload?.purpose !== 'line-link' || !payload.lineUserId) {
    throw Object.assign(new Error('invalid LINE link token'), { status: 400 });
  }
  return payload;
}

function encodeLineState(payload = {}) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    ts: Date.now(),
    nonce: crypto.randomBytes(12).toString('hex'),
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function decodeLineState(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) throw Object.assign(new Error('invalid LINE state'), { status: 400 });
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw Object.assign(new Error('invalid LINE state signature'), { status: 400 });
  }
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!parsed.ts || Date.now() - Number(parsed.ts) > 10 * 60 * 1000) {
    throw Object.assign(new Error('LINE state expired'), { status: 400 });
  }
  return parsed;
}

function appendHash(url, params) {
  const base = String(url || 'http://localhost:5173');
  return `${base.replace(/#.*$/, '')}#${new URLSearchParams(params).toString()}`;
}

function lineLoginConfig() {
  return {
    channelId: process.env.LINE_LOGIN_CHANNEL_ID,
    channelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET,
    callbackUrl: process.env.LINE_LOGIN_CALLBACK_URL || 'http://localhost:3000/api/auth/line/callback',
    successRedirect: process.env.LINE_LOGIN_SUCCESS_REDIRECT || 'http://localhost:5173',
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'username และ password จำเป็น' });

    const rows = await wfQuery(
      `SELECT Id, Username, PasswordHash, DisplayName, Role, RoleCode, AuthVersion, IsActive, MustChangePassword, PositionCode FROM wf.AppUser WHERE Username = @u`,
      { u: { type: sql.NVarChar(50), value: username } }
    );
    const user = rows.recordset?.[0];
    if (!user || !user.IsActive) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const valid = await bcrypt.compare(password, user.PasswordHash);
    if (!valid) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    // R12 item 4: a session that ended by token expiry or a closed browser never sent STOP;
    // close it now so every START has a STOP
    await closeOpenAccessAsSession(user.Id, req);

    const token = signAppToken(user);
    res.json({
      accessToken: token,
      user: toClientUser(user),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auth/line/start
router.get('/line/start', (req, res) => {
  const cfg = lineLoginConfig();
  if (!cfg.channelId || !cfg.channelSecret) return res.status(400).send('LINE Login is not configured');
  
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const dynamicCallbackUrl = process.env.LINE_LOGIN_CALLBACK_URL || `${protocol}://${host}/api/auth/line/callback`;
  
  let dynamicSuccessRedirect = cfg.successRedirect;
  const referer = req.get('referer');
  if (referer && !process.env.LINE_LOGIN_SUCCESS_REDIRECT) {
    try { dynamicSuccessRedirect = new URL(referer).origin; } catch(e) {}
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.channelId,
    redirect_uri: dynamicCallbackUrl,
    state: encodeLineState({ cb: dynamicCallbackUrl, rd: dynamicSuccessRedirect }),
    scope: 'profile openid',
  });
  res.redirect(`${LINE_AUTH_URL}?${params.toString()}`);
});

// GET /api/auth/line/callback
router.get('/line/callback', async (req, res) => {
  const cfg = lineLoginConfig();
  try {
    if (!cfg.channelId || !cfg.channelSecret) throw new Error('LINE Login is not configured');
    
    let statePayload = {};
    try { statePayload = decodeLineState(req.query.state); } catch(e) { throw e; }
    
    const callbackUrl = statePayload.cb || cfg.callbackUrl;
    const successRedirect = statePayload.rd || cfg.successRedirect;

    if (req.query.error) {
      return res.redirect(appendHash(successRedirect, { line_error: String(req.query.error_description || req.query.error) }));
    }
    const code = String(req.query.code || '');
    if (!code) throw new Error('missing LINE code');

    const tokenRes = await fetch(LINE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: cfg.channelId,
        client_secret: cfg.channelSecret,
      }),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) throw new Error(`LINE token exchange failed: ${tokenBody.error_description || tokenRes.statusText}`);

    const profileRes = await fetch(LINE_PROFILE_URL, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const profile = await profileRes.json().catch(() => ({}));
    if (!profileRes.ok || !profile.userId) throw new Error('LINE profile fetch failed');

    const users = await wfQuery(
      `SELECT Id, Username, DisplayName, Role, AuthVersion, RoleCode, IsActive, MustChangePassword, PositionCode
       FROM wf.AppUser
       WHERE LineUserId = @lineUserId`,
      { lineUserId: { type: sql.NVarChar(80), value: profile.userId } }
    );
    const user = users.recordset?.[0];
    if (!user || !user.IsActive) {
      return res.redirect(appendHash(successRedirect, {
        line_link_token: signLineLinkToken(profile),
        line_name: profile.displayName || '',
      }));
    }

    await wfQuery(
      `UPDATE wf.AppUser
       SET LineDisplayName=@dn, LinePictureUrl=@pic, LineLinkedAt=COALESCE(LineLinkedAt, GETUTCDATE()), UpdatedAt=GETUTCDATE()
       WHERE Id=@id`,
      {
        id: { type: sql.Int, value: user.Id },
        dn: { type: sql.NVarChar(150), value: profile.displayName || null },
        pic: { type: sql.NVarChar(500), value: profile.pictureUrl || null },
      }
    );

    res.redirect(appendHash(successRedirect, { line_token: signAppToken(user) }));
  } catch (e) {
    console.error('[line-login]', e.message);
    const fallbackRedirect = process.env.LINE_LOGIN_SUCCESS_REDIRECT || 'http://localhost:5173';
    res.redirect(appendHash(fallbackRedirect, { line_error: e.message || 'line_login_failed' }));
  }
});

// POST /api/auth/line/link
// First-time LINE login: user confirms their existing app username/password, then the LINE account is bound.
router.post('/line/link', async (req, res) => {
  try {
    const { username, password, lineLinkToken } = req.body;
    if (!username || !password || !lineLinkToken) {
      return res.status(400).json({ message: 'username, password และ LINE link token จำเป็น' });
    }

    const line = verifyLineLinkToken(lineLinkToken);
    const rows = await wfQuery(
      `SELECT Id, Username, PasswordHash, DisplayName, Role, AuthVersion, RoleCode, IsActive, MustChangePassword, LineUserId
       FROM wf.AppUser
       WHERE Username = @u`,
      { u: { type: sql.NVarChar(50), value: username } }
    );
    const user = rows.recordset?.[0];
    if (!user || !user.IsActive) {
      return res.status(401).json({ message: 'Login ไม่สำเร็จ กรุณาติดต่อ Admin เพื่อเพิ่มหรือเปิดใช้งานผู้ใช้ก่อน' });
    }

    const valid = await bcrypt.compare(password, user.PasswordHash);
    if (!valid) {
      return res.status(401).json({ message: 'Login ไม่สำเร็จ กรุณาตรวจ username/password หรือติดต่อ Admin' });
    }

    if (user.LineUserId && user.LineUserId !== line.lineUserId) {
      return res.status(409).json({ message: 'ผู้ใช้นี้ผูกกับ LINE อื่นแล้ว กรุณาติดต่อ Admin' });
    }

    const existing = await wfQuery(
      `SELECT TOP 1 Id, Username
       FROM wf.AppUser
       WHERE LineUserId = @lineUserId AND Id <> @id`,
      {
        id: { type: sql.Int, value: user.Id },
        lineUserId: { type: sql.NVarChar(80), value: line.lineUserId },
      }
    );
    if (existing.recordset?.[0]) {
      return res.status(409).json({ message: 'LINE นี้ถูกผูกกับผู้ใช้อื่นแล้ว กรุณาติดต่อ Admin' });
    }

    await wfQuery(
      `UPDATE wf.AppUser
       SET LineUserId=@lineUserId,
           LineDisplayName=@dn,
           LinePictureUrl=@pic,
           LineLinkedAt=GETUTCDATE(),
           UpdatedAt=GETUTCDATE()
       WHERE Id=@id`,
      {
        id: { type: sql.Int, value: user.Id },
        lineUserId: { type: sql.NVarChar(80), value: line.lineUserId },
        dn: { type: sql.NVarChar(150), value: line.lineDisplayName || null },
        pic: { type: sql.NVarChar(500), value: line.linePictureUrl || null },
      }
    );

    res.json({
      accessToken: signAppToken(user),
      user: toClientUser(user),
      linked: true,
    });
  } catch (e) {
    console.error('[line-link]', e.message);
    res.status(e.status || 500).json({ message: e.message || 'LINE link failed' });
  }
});

// GET /api/auth/line/status
router.get('/line/status', (req, res) => {
  const cfg = lineLoginConfig();
  res.json({ configured: !!(cfg.channelId && cfg.channelSecret), callbackUrl: cfg.callbackUrl });
});

// GET /api/auth/access-as/candidates
router.get('/access-as/candidates', requireAuth, requireCapability('access-as'), async (req, res) => {
  try {
    const actor = await loadAppUserById(req.user.actorSub || req.user.sub);
    if (!actor || !actor.IsActive || !hasPermission({role:actor.Role,roles:req.user.actorRoles,permissions:req.user.isImpersonating?req.user.actorPermissions:req.user.permissions},'access-as')) return res.json([]);

    const result = await wfQuery(
      `SELECT u.Id, u.Username, u.DisplayName, u.Role, u.RoleCode, u.EmpId, u.IsActive,
              e.EmpCode, e.EmpName
       FROM wf.AppUser u
       LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpID = u.EmpId
       WHERE u.IsActive = 1
       ORDER BY u.DisplayName`
    );
    const actorId = getUserId(actor);
    const rows = (result.recordset || [])
      .filter(u => getUserId(u) !== actorId && canAccessAs(actor.Role, u.Role))
      .sort((a, b) => (roleRank(b.Role) - roleRank(a.Role)) || String(a.DisplayName || '').localeCompare(String(b.DisplayName || '')));
    res.json(rows);
  } catch (e) {
    console.error('[access-as:candidates]', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/access-as
router.post('/access-as', requireAuth, requireCapability('access-as'), async (req, res) => {
  try {
    const targetId = Number(req.body?.userId);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: 'target user required' });

    const actor = await loadAppUserById(req.user.actorSub || req.user.sub);
    const target = await loadAppUserById(targetId);
    if (!actor || !actor.IsActive) return res.status(401).json({ message: 'Actor user not found' });
    if (!target || !target.IsActive) return res.status(404).json({ message: 'Target user not found' });
    if (!hasPermission({role:actor.Role,roles:req.user.actorRoles,permissions:req.user.isImpersonating?req.user.actorPermissions:req.user.permissions},'access-as') || !canAccessAs(actor.Role, target.Role)) {
      return res.status(403).json({ message: 'Access As is not allowed for this role' });
    }

    if (getUserId(actor) === getUserId(target)) {
      const accessToken = signAppToken(actor);
      return res.json({ accessToken, user: toClientUser(actor) });
    }

    // R12 item 4: switching directly from one target to another closes the previous session first
    const currentEffective = Number(req.user.sub);
    if (currentEffective && currentEffective !== getUserId(actor) && currentEffective !== getUserId(target)) {
      await recordAccessAsAudit(getUserId(actor), currentEffective, 'STOP', req);
    }
    const accessToken = signAppToken(target, actor);
    await recordAccessAsAudit(getUserId(actor), getUserId(target), 'START', req);
    res.json({ accessToken, user: toClientUser(target, actor) });
  } catch (e) {
    console.error('[access-as:start]', e);
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// POST /api/auth/access-as/stop
router.post('/access-as/stop', requireAuth, async (req, res) => {
  try {
    const actor = await loadAppUserById(req.user.actorSub || req.user.sub);
    if (!actor || !actor.IsActive) return res.status(401).json({ message: 'Actor user not found' });

    if (Number(req.user.sub) !== getUserId(actor)) {
      await recordAccessAsAudit(getUserId(actor), Number(req.user.sub), 'STOP', req);
    }

    const accessToken = signAppToken(actor);
    res.json({ accessToken, user: toClientUser(actor) });
  } catch (e) {
    console.error('[access-as:stop]', e);
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await loadAppUserById(req.user.sub);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const actor = Number(req.user.actorSub || req.user.sub) !== Number(req.user.sub)
      ? await loadAppUserById(req.user.actorSub)
      : null;
    const client=toClientUser(user, actor);
    client.roleCode=req.user.roleCode||user.Role;
    client.roleCodes=req.user.roleCodes; client.roles=req.user.roles;
    client.capabilities=require('../services/role-profiles').filteredCapabilities({...req.user,positionCode:user.PositionCode});
    res.json(client);
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Database selection (owner 2026-10-25) ─────────────────────
// GET the picker data: the session's active database, the system default, the list offered, and color theme metadata.
router.get('/databases', requireAuth, async (req, res) => {
  try {
    const canSwitch = hasPermission(req.user, 'database.switch');
    const canSetSystem = hasPermission(req.user, 'database.set-system');
    const [system, rawList, themes] = await Promise.all([
      activeDb.systemActiveDatabase(),
      (canSwitch || canSetSystem) ? activeDb.listSwitchableDatabases() : Promise.resolve([]),
      activeDb.getDatabaseThemes(),
    ]);
    const active = getDbName() || system;

    const uRoles = userRoles(req.user);
    const isAdmin = uRoles.includes('ADMIN');

    // Build rich metadata for all candidate databases
    const metaList = rawList.map(dbName => {
      const theme = activeDb.resolveTheme(dbName, themes);
      const restrictedRoles = Array.isArray(theme.restrictedRoles) ? theme.restrictedRoles : [];
      const isRestricted = restrictedRoles.length > 0;
      const isAllowed = !isRestricted || isAdmin || uRoles.some(r => restrictedRoles.includes(r));
      return {
        name: dbName,
        color: theme.color || 'blue',
        label: theme.label || dbName,
        badge: theme.badge || '',
        description: theme.description || '',
        restrictedRoles,
        isRestricted,
        isAllowed,
      };
    });

    // list contains databases this user can switch into
    const list = metaList.filter(m => m.isAllowed).map(m => m.name);

    res.json({
      active,
      system,
      primary: activeDb.primaryDatabase(),
      list,
      metaList,
      themes,
      canSwitch,
      canSetSystem,
    });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST switch this session to another database (empty body resets to the system default).
router.post('/switch-database', requireAuth, async (req, res) => {
  try {
    if (!hasPermission(req.user, 'database.switch')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'บทบาทนี้ไม่มีสิทธิ์สลับฐานข้อมูล' });
    }
    const wanted = String(req.body?.database || '').trim();
    const system = await activeDb.systemActiveDatabase();
    if (!wanted || wanted.toLowerCase() === system.toLowerCase()) {
      // Reset to the system default: drop the claim.
      return res.json({ accessToken: reissueWithDatabase(req.tokenPayload, null), database: system, isDefault: true });
    }
    const list = await activeDb.listSwitchableDatabases();
    if (!list.some(d => d.toLowerCase() === wanted.toLowerCase())) {
      return res.status(400).json({ code: 'DB_NOT_ALLOWED', message: 'เลือกได้เฉพาะฐานข้อมูลที่ระบบอนุญาตและเปิดใช้งานได้' });
    }
    const database = list.find(d => d.toLowerCase() === wanted.toLowerCase());

    // Security restriction check (e.g. dbwins_worldfert2 -> Accounting, C_Level, Admin)
    const themes = await activeDb.getDatabaseThemes();
    const theme = activeDb.resolveTheme(database, themes);
    const restrictedRoles = Array.isArray(theme.restrictedRoles) ? theme.restrictedRoles : [];
    if (restrictedRoles.length > 0) {
      const uRoles = userRoles(req.user);
      const isAuthorized = uRoles.includes('ADMIN') || uRoles.some(r => restrictedRoles.includes(r));
      if (!isAuthorized) {
        return res.status(403).json({
          code: 'DB_RESTRICTED',
          message: `ฐานข้อมูล ${database} (${theme.label || 'PROD_DB_RD'}) สงวนไว้เฉพาะทีมที่ได้รับอนุญาต (${restrictedRoles.join(', ')})`,
        });
      }
    }

    res.json({ accessToken: reissueWithDatabase(req.tokenPayload, database), database, isDefault: false });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT the system-wide default database (admin). Affects everyone who has not switched.
router.put('/system-database', requireAuth, async (req, res) => {
  try {
    if (!hasPermission(req.user, 'database.set-system')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    }
    const database = await activeDb.setSystemActiveDatabase(String(req.body?.database || '').trim());
    res.json({ system: database });
  } catch (e) {
    if (e.code === 'DB_NOT_ALLOWED') return res.status(400).json({ code: e.code, message: 'เลือกได้เฉพาะฐานข้อมูลที่ระบบอนุญาต' });
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT update database color themes and metadata (admin / database.set-system)
router.put('/database-themes', requireAuth, async (req, res) => {
  try {
    const uRoles = userRoles(req.user);
    const canManage = hasPermission(req.user, 'database.set-system') || uRoles.includes('ADMIN');
    if (!canManage) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่มีสิทธิ์ตั้งค่าสีฐานข้อมูล' });
    }
    const themes = req.body?.themes;
    if (!themes || typeof themes !== 'object') {
      return res.status(400).json({ code: 'INVALID_THEMES', message: 'ข้อมูลการตั้งค่าสีไม่ถูกต้อง' });
    }
    const saved = await activeDb.setDatabaseThemes(themes);
    res.json({ ok: true, themes: saved });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { address, phone, email, idCardNo, taxId } = req.body;
    await wfQuery(
      `UPDATE wf.AppUser SET Address=@a, Phone=@p, Email=@e, IdCardNo=@idCard, TaxId=@tax, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      {
        id: { type: sql.Int, value: req.user.sub },
        a: { type: sql.NVarChar(500), value: address || null },
        p: { type: sql.NVarChar(50), value: phone || null },
        e: { type: sql.NVarChar(100), value: email || null },
        idCard: { type: sql.NVarChar(20), value: idCardNo || null },
        tax: { type: sql.NVarChar(20), value: taxId || null },
      }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/auth/profile/password
router.put('/profile/password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const rows = await wfQuery(`SELECT PasswordHash FROM wf.AppUser WHERE Id=@id`, { id: { type: sql.Int, value: req.user.sub } });
    const user = rows.recordset[0];
    if (!user) return res.status(404).json({ message: 'User not found' });

    const valid = await bcrypt.compare(oldPassword, user.PasswordHash);
    if (!valid) return res.status(401).json({ message: 'รหัสผ่านเดิมไม่ถูกต้อง' });

    const hash = await bcrypt.hash(newPassword, 12);
    await wfQuery(`UPDATE wf.AppUser SET PasswordHash=@ph, MustChangePassword=0, UpdatedAt=GETUTCDATE() WHERE Id=@id`, {
      id: { type: sql.Int, value: req.user.sub },
      ph: { type: sql.NVarChar(255), value: hash },
    });
    // ต้องออก token ใหม่ ไม่งั้นผู้ใช้ยังถือ token ที่บอกว่า mustChangePassword=1
    // แล้วถูกบล็อกการเขียนต่อไปอีกจนกว่า token เดิมหมดอายุ ทั้งที่เปลี่ยนรหัสแล้ว
    const fresh = await loadAppUserById(req.user.sub);
    res.json({
      ok: true,
      accessToken: fresh ? signAppToken(fresh) : undefined,
      user: fresh ? toClientUser(fresh) : undefined,
    });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/profile/signature
router.post('/profile/signature', requireAuth, upload.single('signature'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'ไม่มีไฟล์ที่อัพโหลด' });
    const filename = req.file.filename;
    await wfQuery(`UPDATE wf.AppUser SET SignatureFile=@sig, UpdatedAt=GETUTCDATE() WHERE Id=@id`, {
      id: { type: sql.Int, value: req.user.sub },
      sig: { type: sql.NVarChar(255), value: filename },
    });
    res.json({ ok: true, filename });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/users (ADMIN/MANAGER/ACCOUNTING)
router.post('/users', requireAuth, requireCapability('users.manage'), requireCapability('roles.manage'), async (req, res) => {
  try {
    const { username, password, displayName, role, empId } = req.body;
    const codes=req.body.roleCodes===undefined?null:roleWrite.membershipCodes(req.body.roleCodes);
    if(req.body.isActive!==undefined&&typeof req.body.isActive!=='boolean')return res.status(400).json({message:'สถานะผู้ใช้ต้องเป็น true หรือ false'});
    if(codes && role!==undefined)return res.status(400).json({message:"ส่ง roleCodes หรือ role อย่างใดอย่างหนึ่ง"});
    const callerRole = String(req.user.role).toUpperCase();
    const callerRank = roleRank(callerRole);
    const newRole = codes ? null : String(role || '').toUpperCase();
    if(!codes && !Object.keys(ACCESS_AS_ROLE_RANK).includes(newRole))return res.status(400).json({message:'Role ไม่ถูกต้อง'});
    if(req.user.isImpersonating)return res.status(403).json({message:'ออกจาก Access As ก่อนสร้างผู้ใช้'});
    const targetRank = roleRank(newRole);

    // Only ADMIN may create users with role ADMIN or C_LEVEL
    if ((newRole === 'ADMIN' || newRole === 'C_LEVEL') && callerRole !== 'ADMIN') {
      return res.status(403).json({ message: 'เฉพาะ ADMIN เท่านั้นที่สามารถสร้างผู้ใช้ระดับ ADMIN หรือ C_LEVEL ได้' });
    }
    // Non-ADMIN callers may not assign a role equal to or above their own
    if (!codes && callerRole !== 'ADMIN' && targetRank >= callerRank) {
      return res.status(403).json({ message: 'ไม่สามารถกำหนดบทบาทที่เทียบเท่าหรือสูงกว่าตนเองได้' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await wfTransaction(async tx=>{
      await roleWrite.lockPolicy(tx,req.user.id,'roles.manage');
      await roleWrite.lockPolicy(tx,req.user.id,'users.manage');
      const primary=codes?await roleWrite.validateAssignment(tx,codes,callerRole):{BaseRole:newRole};
      const execute=async(text,inputs)=>{const q=tx.request();for(const [k,v] of Object.entries(inputs))q.input(k,v.type,v.value);return q.query(text);};
      const result = await execute(
      // R12 item 5: the admin knows the first password, so the owner must replace it
      `INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, MustChangePassword)
       OUTPUT inserted.Id, inserted.Username, inserted.DisplayName, inserted.Role
       VALUES (@u, @h, @d, @r, @e, 1)`,
      {
        u: { type: sql.NVarChar(50), value: username },
        h: { type: sql.NVarChar(255), value: hash },
        d: { type: sql.NVarChar(100), value: displayName },
        r: { type: sql.NVarChar(30), value: primary.BaseRole },
        e: { type: sql.NVarChar(20), value: empId || null },
      }
      );
      await roleWrite.setMembership(tx,result.recordset[0].Id,codes||[newRole]);
      const fields={address:'Address',phone:'Phone',email:'Email',idCardNo:'IdCardNo',taxId:'TaxId',isActive:'IsActive'};
      const extras=Object.keys(fields).filter(k=>req.body[k]!==undefined);
      if(extras.length)await roleWrite.query(tx,'UPDATE wf.AppUser SET '+extras.map(k=>fields[k]+'=@'+k).join(',')+' WHERE Id=@id',Object.assign({id:result.recordset[0].Id},Object.fromEntries(extras.map(k=>[k,req.body[k]|| (k==='isActive'?false:null)]))));
      if(codes) await roleWrite.query(tx,"INSERT wf.AdminChangeAudit(ActorId,Action,Target,Detail) VALUES(@actor,'USER_ROLES',@target,@detail)",{actor:Number(req.user.id),target:String(result.recordset[0].Id),detail:JSON.stringify({before:[],after:codes})});

      return result;
    });
    // owner 2026-10-09: a salesperson or sales manager gets a rebate requester code automatically
    await giveRebateDocCode(result.recordset[0]?.Id);
    res.json(result.recordset[0]);
  } catch (e) {
    if (e.number === 2627) return res.status(409).json({ message: 'ชื่อผู้ใช้ซ้ำ' });
    if(e.status) return res.status(e.status).json({message:e.message});
    if (e.number === 2601) return res.status(409).json({ message: 'พนักงานรหัสนี้ถูกผูกกับผู้ใช้อื่นไปแล้ว' });
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auth/users (ADMIN/MANAGER/ACCOUNTING)
router.get('/users', requireAuth, requireCapability('users.manage'), async (req, res) => {
  try {
    const result = await wfQuery(
      `SELECT u.Id, u.Username, u.DisplayName, u.Role, u.RoleCode, u.EmpId, u.IsActive, u.CreatedAt,
              u.Address, u.Phone, u.Email, u.IdCardNo, u.TaxId, u.SignatureFile,
              u.LineUserId, u.LineDisplayName, u.LineLinkedAt,
              e.EmpCode, e.EmpName,
              u.PositionCode, p.PositionName, p.OrgUnit, p.Tier,
              p.DefaultRole AS PositionDefaultRole, p.CanApprove,
              na.ApproverPosition, na.ApproverName, na.ApproverRole
       FROM wf.AppUser u
       LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpID = u.EmpId
       LEFT JOIN wf.OrgPosition p ON p.PositionCode = u.PositionCode
       LEFT JOIN wf.v_NearestApprover na ON na.PositionCode = u.PositionCode
       ORDER BY u.DisplayName`
    );
    const memberships = (await wfQuery('SELECT r.UserId, r.RoleCode, p.BaseRole FROM wf.vUserRole r JOIN wf.RoleProfile p ON p.Code = r.RoleCode')).recordset;
    res.json(result.recordset.map(u => {
      const userMemberships = memberships.filter(r => Number(r.UserId) === Number(u.Id));
      let roleCodes = userMemberships.map(r => r.RoleCode);
      let roles = [...new Set(userMemberships.map(r => r.BaseRole))];
      if (roleCodes.length === 0) {
        const fallback = u.RoleCode || u.Role;
        if (fallback) {
          roleCodes = [fallback];
          roles = [u.Role || fallback];
        }
      }
      return {
        ...u,
        RoleCodes: roleCodes,
        Roles: roles
      };
    }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/auth/users/:id — แก้ไข ADMIN/MANAGER/ACCOUNTING
router.patch('/users/:id', requireAuth, requireCapability('users.manage'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const callerId = Number(req.user.sub ?? req.user.id);
    const callerRole = String(req.user.role).toUpperCase();
    const callerRank = roleRank(callerRole);
    const codes=req.body.roleCodes===undefined?null:roleWrite.membershipCodes(req.body.roleCodes);
    const expectedCodes=codes?roleWrite.membershipCodes(req.body.expectedRoleCodes):null;
    if(codes && req.body.role!==undefined)return res.status(400).json({message:'ส่ง roleCodes หรือ role อย่างใดอย่างหนึ่ง'});
    if(codes && callerId===targetId)return res.status(403).json({message:'ไม่อนุญาตให้แก้ไขบทบาทของตนเอง'});
    if(codes && !hasPermission(req.user,'roles.manage'))return res.status(403).json({message:'ต้องการสิทธิ์จัดการ Role'});

    // 1. No one may change their own role
    if (callerId === targetId && req.body.role !== undefined) {
      if (String(req.body.role).toUpperCase() !== callerRole) {
        return res.status(403).json({ message: 'ไม่อนุญาตให้แก้ไขบทบาทของตนเอง' });
      }
    }

    // 2. Load target user from DB to verify target's current rank
    const targetUser = await loadAppUserById(targetId);
    if (!targetUser) return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
    const targetRole = String(targetUser.Role).toUpperCase();
    const targetRank = roleRank(targetRole);

    if (callerRole !== 'ADMIN') {
      // Only ADMIN may edit users with role ADMIN or C_LEVEL
      if (targetRole === 'ADMIN' || targetRole === 'C_LEVEL') {
        return res.status(403).json({ message: 'เฉพาะ ADMIN เท่านั้นที่สามารถแก้ไขผู้ใช้ระดับ ADMIN หรือ C_LEVEL ได้' });
      }

      // Non-ADMIN callers: may edit only users of strictly lower rank
      if (callerId !== targetId && targetRank >= callerRank) {
        return res.status(403).json({ message: 'ไม่สามารถแก้ไขข้อมูลของผู้ใช้ที่มีระดับเทียบเท่าหรือสูงกว่าตนเองได้' });
      }

      // Non-ADMIN callers: may not reset passwords of equal or higher rank
      if (req.body.password && callerId !== targetId && targetRank >= callerRank) {
        return res.status(403).json({ message: 'ไม่สามารถรีเซ็ตรหัสผ่านของผู้ใช้ที่มีระดับเทียบเท่าหรือสูงกว่าตนเองได้' });
      }

      // Non-ADMIN callers: may not assign a role equal to or above their own
      if (req.body.role !== undefined) {
        const assignedRole = String(req.body.role).toUpperCase();
        const assignedRank = roleRank(assignedRole);
        if (assignedRank >= callerRank) {
          return res.status(403).json({ message: 'ไม่สามารถกำหนดบทบาทที่เทียบเท่าหรือสูงกว่าตนเองได้' });
        }
        if (assignedRole === 'ADMIN' || assignedRole === 'C_LEVEL') {
          return res.status(403).json({ message: 'เฉพาะ ADMIN เท่านั้นที่สามารถแต่งตั้งบทบาท ADMIN หรือ C_LEVEL ได้' });
        }
      }
    } else {
      // ADMIN editing: No one may change their own role
      if (callerId === targetId && req.body.role !== undefined && String(req.body.role).toUpperCase() !== callerRole) {
        return res.status(403).json({ message: 'ไม่อนุญาตให้แก้ไขบทบาทของตนเอง' });
      }
    }

    if(req.user.isImpersonating) return res.status(403).json({message:'ออกจาก Access As ก่อนแก้ผู้ใช้'});
    if(req.body.isActive!==undefined && typeof req.body.isActive!=='boolean') return res.status(400).json({message:'สถานะผู้ใช้ต้องเป็น true หรือ false'});
    if(req.body.role!==undefined && !Object.keys(ACCESS_AS_ROLE_RANK).includes(req.body.role)) return res.status(400).json({message:'Role ไม่ถูกต้อง'});
    if(targetId===callerId && req.body.isActive===false) return res.status(400).json({message:'ไม่สามารถปิดบัญชีตัวเองได้'});
    const { empId, role, displayName, isActive, password, lineUserId, address, phone, email, idCardNo, taxId, positionCode } = req.body;
    const sets = [];
    const inputs = { id: { type: sql.Int, value: targetId } };
    if (empId !== undefined)       { sets.push('EmpId = @empId');        inputs.empId       = { type: sql.NVarChar(20),  value: empId || null }; }
    // ตำแหน่งในผังองค์กร — ส่งค่าว่างมาเพื่อถอดออกได้ · FK กันรหัสที่ไม่มีจริงอยู่แล้ว
    if (positionCode !== undefined) { sets.push('PositionCode = @pos');   inputs.pos         = { type: sql.VarChar(30),   value: positionCode || null }; }
    if(role!==undefined && role!==targetUser.Role && !hasPermission(req.user,'roles.manage')) return res.status(403).json({message:'ต้องการสิทธิ์จัดการ Role'});
    if (role !== undefined)        { sets.push('Role = @role'); if(role!==targetUser.Role) sets.push('RoleCode = NULL');          inputs.role        = { type: sql.NVarChar(30),  value: role }; }
    if (displayName !== undefined) { sets.push('DisplayName = @dn');      inputs.dn          = { type: sql.NVarChar(100), value: displayName }; }
    if (isActive !== undefined)    { sets.push('IsActive = @act');       inputs.act         = { type: sql.Bit,          value: isActive ? 1 : 0 }; }
    if (address !== undefined)     { sets.push('Address = @addr');       inputs.addr        = { type: sql.NVarChar(500), value: address || null }; }
    if (phone !== undefined)       { sets.push('Phone = @phn');          inputs.phn         = { type: sql.NVarChar(50),  value: phone || null }; }
    if (email !== undefined)       { sets.push('Email = @eml');          inputs.eml         = { type: sql.NVarChar(100), value: email || null }; }
    if (idCardNo !== undefined)    { sets.push('IdCardNo = @idc');       inputs.idc         = { type: sql.NVarChar(20),  value: idCardNo || null }; }
    if (taxId !== undefined)       { sets.push('TaxId = @tax');          inputs.tax         = { type: sql.NVarChar(20),  value: taxId || null }; }
    if (lineUserId !== undefined)  {
      sets.push('LineUserId = @lineUserId');
      sets.push('LineLinkedAt = CASE WHEN @lineUserId IS NULL THEN NULL ELSE COALESCE(LineLinkedAt, GETUTCDATE()) END');
      inputs.lineUserId = { type: sql.NVarChar(80), value: lineUserId || null };
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      sets.push('PasswordHash = @ph');
      inputs.ph = { type: sql.NVarChar(255), value: hash };
      // ผู้ดูแลตั้งรหัสให้คนอื่น = ผู้ดูแลรู้รหัสของคนนั้น ถ้าปล่อยไว้อย่างนั้น
      // ชื่อผู้ทำรายการในหลักฐานก็ไม่ได้พิสูจน์ว่าเจ้าของบัญชีเป็นคนทำ (D6-02)
      // จึงบังคับให้เจ้าของบัญชีตั้งรหัสใหม่ก่อนบันทึกข้อมูลได้อีก
      // ยกเว้นกรณีเปลี่ยนรหัสของตัวเอง ซึ่งไม่มีใครอื่นรู้รหัสนั้น
      if (targetId !== callerId) {
        sets.push('MustChangePassword = 1');
      } else {
        sets.push('MustChangePassword = 0');
      }
    }
    if (!sets.length && !codes) return res.status(400).json({ message: 'ไม่มีข้อมูลที่จะแก้ไข' });
    const securityChanged = codes || (role!==undefined && role!==targetUser.Role)
      || (isActive!==undefined && isActive!==Boolean(targetUser.IsActive))
      || password || (lineUserId!==undefined && (lineUserId||null)!==(targetUser.LineUserId||null));
    if(securityChanged) sets.push('AuthVersion = AuthVersion + 1');
    sets.push('UpdatedAt = GETUTCDATE()');
    const __r = await wfTransaction(async tx=>{
      await roleWrite.lockPolicy(tx,callerId,'users.manage');
      if(codes){
        await roleWrite.lockPolicy(tx,callerId,'roles.manage');
        await roleWrite.validateAssignment(tx,codes,callerRole);
        const current=(await roleWrite.query(tx,'SELECT RoleCode FROM wf.vUserRole WHERE UserId=@id',{id:targetId})).recordset.map(r=>r.RoleCode).sort();
        if(JSON.stringify(current)!==JSON.stringify(expectedCodes))throw roleWrite.error('Role ของผู้ใช้เปลี่ยนแล้ว กรุณาปิดและเปิดข้อมูลใหม่ก่อนบันทึก');
      }
      const q=tx.request();for(const [k,v] of Object.entries(inputs))q.input(k,v.type,v.value);
      const result=await q.query(`UPDATE wf.AppUser SET ${sets.join(', ')} WHERE Id=@id`);
      if(codes){
        await roleWrite.setMembership(tx,targetId,codes);
        await roleWrite.query(tx,"INSERT wf.AdminChangeAudit(ActorId,Action,Target,Detail) VALUES(@actor,'USER_ROLES',@target,@detail)",{actor:callerId,target:String(targetId),detail:JSON.stringify({before:expectedCodes,after:codes})});
      }else if(role!==undefined && role!==targetUser.Role) await roleWrite.setMembership(tx,targetId,[role]);
      
      const oldPos = targetUser.PositionCode || null;
      const newPos = positionCode ? String(positionCode).trim() : null;
      if (positionCode !== undefined && oldPos !== newPos) {
        if (req.body.expectedPositionCode !== undefined) {
          const expPos = req.body.expectedPositionCode ? String(req.body.expectedPositionCode).trim() : null;
          if (expPos !== oldPos) {
            throw roleWrite.error('ตำแหน่งของผู้ใช้เปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก', 409);
          }
        }
        await roleWrite.query(tx, "INSERT INTO wf.AdminChangeAudit(ActorId, Action, Target, Detail) VALUES(@actor, 'USER_POSITION', @target, @detail)", {
          actor: callerId,
          target: String(targetId),
          detail: JSON.stringify({ before: oldPos, after: newPos, username: targetUser.Username })
        });
      }
      await roleWrite.assertAdministrator(tx);
      return result;
    });
    if (!__r.rowsAffected?.[0]) return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
    // disabling or re-enabling takes effect on the user's very next request
    clearAccountStatusCache(targetId);
    if (codes || role !== undefined || isActive !== undefined) await giveRebateDocCode(targetId);
    res.json({ ok: true, id: targetId });
  } catch (e) {
    if(e.status) return res.status(e.status).json({message:e.message});
    if (e.number === 2601) return res.status(409).json({ message: 'พนักงานรหัสนี้ถูกผูกกับผู้ใช้อื่นไปแล้ว' });
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auth/org-positions — ผังตำแหน่งสำหรับหน้าจับคู่ผู้ใช้ ↔ ตำแหน่ง
//
// คืนจำนวนคนที่ถือแต่ละตำแหน่งมาด้วย เพราะบางตำแหน่งมีได้คนเดียว (ผจก.ฝ่าย)
// แต่บางตำแหน่งมีได้หลายคน (พนักงานขายเขต) — หน้าจอต้องเห็นก่อนตัดสินใจ
router.get('/org-positions', requireAuth, requireRole('ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT p.PositionCode, p.PositionName, p.ReportsTo, p.OrgUnit, p.Tier,
             p.DefaultRole, p.CanApprove, p.IsActive, p.Note,
             mgr.PositionName AS ReportsToName,
             (SELECT COUNT(*) FROM wf.AppUser u WHERE u.PositionCode = p.PositionCode) AS AssignedCount
      FROM   wf.OrgPosition p
      LEFT   JOIN wf.OrgPosition mgr ON mgr.PositionCode = p.ReportsTo
      ORDER  BY p.OrgUnit, p.Tier, p.PositionName`);
    res.json(r.recordset);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});


// GET /api/auth/org-hints — ตัวช่วยจับคู่ผู้ใช้ ↔ ตำแหน่ง
//
// ทำไมต้องมี
//   ผังองค์กรมี 43 ตำแหน่ง ผู้ใช้ที่ต้องผูกมี 42 คน ถ้าให้เลือกจากรายการเต็ม
//   ทุกครั้ง คนกรอกต้องอ่าน 43 บรรทัดต่อคน รวม ~1,800 ครั้ง ซึ่งพลาดง่าย
//   endpoint นี้ตัดตัวเลือกให้เหลือเฉพาะที่เป็นไปได้ตามข้อมูลที่ระบบมีจริง
//
// ⚠ นี่คือ "ตัวช่วยกรอง" ไม่ใช่การระบุตำแหน่ง
//   ระบบไม่รู้ว่าใครถือตำแหน่งไหน — dbo.EMEmp มี PostID แค่ 9 คนจาก 61
//   และตำแหน่งของ WINSpeed (10 รายการ) หยาบกว่าผังเรา (43 รายการ) มาก
//   เช่น "กรรมการบริหาร" ตัวเดียวตรงกับผังเราได้ 3 ตำแหน่ง
//   คนที่กรอกต้องเป็นผู้ตัดสินเสมอ ระบบทำได้แค่ย่นรายการให้สั้นลง
//
// อ่านอย่างเดียวทั้งหมด ไม่เขียนอะไรทั้งสิ้น
//
// แผนก WINSpeed → สายงานในผังของเรา
// จับคู่ตามความหมายของชื่อแผนก ไม่ได้เดารายบุคคล
const DEPT_TO_UNIT = {
  'ตรารถเกษตร':   'ขาย-การตลาด',
  'ตรา ปุ๋ยเทพ':  'ขาย-การตลาด',
  'บัญชี':        'บัญชี-การเงิน',
  'การเงิน':      'บัญชี-การเงิน',
  'งานผลิต':      'โรงงาน',
  'งานซ่อมบำรุง': 'โรงงาน',
  'ห้องชั่ง':     'โรงงาน',
  'คลังสำเร็จรูป': 'โรงงาน',
  'ห้องกระสอบ':   'โรงงาน',
};

router.get('/org-hints', requireAuth, requireRole('ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    // จับคู่ AppUser กับทะเบียนพนักงานด้วยชื่อ — ทางเดียวที่ใช้ได้จริง
    // (EmpID / EmpCode / EMEmp.username จับคู่ไม่ได้เลยสักคน ตรวจแล้ว 3 ทาง)
    const users = (await wfQuery(`
      SELECT u.Id, u.Username, u.DisplayName, u.Role, u.PositionCode,
             RTRIM(d.DeptName) AS WsDept,
             RTRIM(po.PostName) AS WsPost
      FROM   wf.AppUser u
      LEFT   JOIN dbo.EMEmp  e  ON RTRIM(e.EmpName) = u.DisplayName
      LEFT   JOIN dbo.EMDept d  ON d.DeptID = e.DeptID
      LEFT   JOIN dbo.EMPost po ON po.PostID = e.PostID
      WHERE  u.IsActive = 1
      ORDER  BY u.Id`)).recordset;

    const positions = (await wfQuery(`
      SELECT PositionCode, PositionName, OrgUnit, Tier, DefaultRole, CanApprove
      FROM   wf.OrgPosition
      WHERE  IsActive = 1
      ORDER  BY Tier, OrgUnit, PositionCode`)).recordset;

    const data = users.map(u => {
      const unitHint = u.WsDept ? DEPT_TO_UNIT[String(u.WsDept).trim()] || null : null;

      // ผู้สมัครที่เป็นไปได้ = ตำแหน่งที่บทบาทเริ่มต้นตรงกับบทบาทจริงของผู้ใช้
      // บทบาทคือสิ่งเดียวที่ระบบ "รู้จริง" เกี่ยวกับคนคนนี้
      let candidates = positions.filter(p => p.DefaultRole && p.DefaultRole === u.Role);

      // ถ้ารู้แผนกจาก WINSpeed ให้แคบลงอีกชั้น แต่ไม่ตัดทิ้งถ้าเหลือศูนย์
      if (unitHint) {
        const narrowed = candidates.filter(p => p.OrgUnit === unitHint);
        if (narrowed.length > 0) candidates = narrowed;
      }

      return {
        id: u.Id,
        username: u.Username,
        displayName: u.DisplayName,
        role: u.Role,
        positionCode: u.PositionCode,
        // สิ่งที่ WINSpeed บอกได้ — ส่วนใหญ่จะว่าง
        winspeed: { dept: u.WsDept || null, post: u.WsPost || null, unitHint },
        candidates: candidates.map(p => ({
          positionCode: p.PositionCode,
          positionName: p.PositionName,
          orgUnit: p.OrgUnit,
          tier: p.Tier,
          canApprove: p.CanApprove,
        })),
      };
    });

    const withDept = data.filter(x => x.winspeed.dept).length;
    const withPost = data.filter(x => x.winspeed.post).length;

    res.json({
      data,
      summary: {
        activeUsers: data.length,
        assigned: data.filter(x => x.positionCode).length,
        winspeedDeptKnown: withDept,
        winspeedPostKnown: withPost,
        // บอกตรง ๆ ว่าระบบยืนยันตำแหน่งเองไม่ได้ หน้าจอจะได้ไม่แสดงเกินจริง
        note: 'ระบบระบุตำแหน่งให้อัตโนมัติไม่ได้ — WINSpeed บันทึกตำแหน่งไว้ไม่ครบ และตำแหน่งของ WINSpeed หยาบกว่าผังองค์กร รายการที่แนะนำเป็นเพียงตัวช่วยกรอง ผู้ดูแลต้องเป็นผู้ตัดสิน',
      },
    });
  } catch (e) {
    console.error('[auth/org-hints]', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/auth/users/:id — ลบผู้ใช้ (ADMIN/MANAGER/ACCOUNTING, ห้ามลบตัวเอง)
router.delete('/users/:id', requireAuth, requireCapability('users.manage'), async (req, res) => {
  try {
    if(req.user.isImpersonating) return res.status(403).json({message:'ออกจาก Access As ก่อนลบผู้ใช้'});
    const targetId = Number(req.params.id);
    const callerId = Number(req.user.sub ?? req.user.id);
    const callerRole = String(req.user.role).toUpperCase();
    const callerRank = roleRank(callerRole);

    if (targetId === callerId) return res.status(400).json({ message: 'ไม่สามารถลบบัญชีตัวเองได้' });

    const targetUser = await loadAppUserById(targetId);
    if (!targetUser) return res.status(404).json({ message: 'ไม่พบรายการที่ระบุ' });
    const targetRole = String(targetUser.Role).toUpperCase();
    const targetRank = roleRank(targetRole);

    if (callerRole !== 'ADMIN') {
      if (targetRole === 'ADMIN' || targetRole === 'C_LEVEL') {
        return res.status(403).json({ message: 'เฉพาะ ADMIN เท่านั้นที่สามารถลบผู้ใช้ระดับ ADMIN หรือ C_LEVEL ได้' });
      }
      if (targetRank >= callerRank) {
        return res.status(403).json({ message: 'ไม่สามารถลบผู้ใช้ที่มีระดับเทียบเท่าหรือสูงกว่าตนเองได้' });
      }
    }

    const __r = await wfTransaction(async tx=>{
      await roleWrite.lockPolicy(tx,callerId,'users.manage');
      const result=await roleWrite.query(tx,'DELETE FROM wf.AppUser WHERE Id=@id',{id:targetId});
      await roleWrite.assertAdministrator(tx);return result;
    });
    if (!__r.rowsAffected[0]) return res.status(404).json({ message: 'ไม่พบรายการที่ระบุ' });
    clearAccountStatusCache(targetId);
    res.json({ ok: true });
  } catch (e) { if(e.status)return res.status(e.status).json({message:e.message});console.error(e); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
