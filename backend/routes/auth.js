const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole, passwordChangeEnforced, SECRET } = require('../middleware/auth');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads/signatures')),
    filename: (req, file, cb) => cb(null, `sig_${req.user.sub}_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const LINE_AUTH_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';

const ACCESS_AS_ROLE_RANK = Object.freeze({
  SALES: 1,
  COUNTER_SALES: 2,
  APPROVER: 3,
  ACCOUNTING: 4,
  MANAGER: 5,
  ADMIN: 6,
});
const ACCESS_AS_ACTOR_ROLES = new Set(['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'COUNTER_SALES']);

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
    // บอกหน้าจอเฉพาะเมื่อเซิร์ฟเวอร์บังคับจริง — บนเครื่องนักพัฒนาจะไม่ขึ้นหน้าบังคับ
    // เปลี่ยนรหัสมากั้นงาน ทั้งที่ธงในฐานข้อมูลยังอยู่ตามเดิม
    mustChangePassword: passwordChangeEnforced()
      && Boolean(user.MustChangePassword ?? user.mustChangePassword),
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
  return jwt.sign(appUserPayload(user, actor), SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

async function loadAppUserById(id) {
  const rows = await wfQuery(
    `SELECT Id, Username, DisplayName, Role, EmpId, IsActive, MustChangePassword,
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
      `SELECT Id, Username, PasswordHash, DisplayName, Role, IsActive, MustChangePassword FROM wf.AppUser WHERE Username = @u`,
      { u: { type: sql.NVarChar(50), value: username } }
    );
    const user = rows.recordset?.[0];
    if (!user || !user.IsActive) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const valid = await bcrypt.compare(password, user.PasswordHash);
    if (!valid) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

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
      `SELECT Id, Username, DisplayName, Role, IsActive
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
      `SELECT Id, Username, PasswordHash, DisplayName, Role, IsActive, LineUserId
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
router.get('/access-as/candidates', requireAuth, async (req, res) => {
  try {
    const actor = await loadAppUserById(req.user.actorSub || req.user.sub);
    if (!actor || !actor.IsActive || !canUseAccessAs(actor.Role)) return res.json([]);

    const result = await wfQuery(
      `SELECT u.Id, u.Username, u.DisplayName, u.Role, u.EmpId, u.IsActive,
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
router.post('/access-as', requireAuth, async (req, res) => {
  try {
    const targetId = Number(req.body?.userId);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: 'target user required' });

    const actor = await loadAppUserById(req.user.actorSub || req.user.sub);
    const target = await loadAppUserById(targetId);
    if (!actor || !actor.IsActive) return res.status(401).json({ message: 'Actor user not found' });
    if (!target || !target.IsActive) return res.status(404).json({ message: 'Target user not found' });
    if (!canUseAccessAs(actor.Role) || !canAccessAs(actor.Role, target.Role)) {
      return res.status(403).json({ message: 'Access As is not allowed for this role' });
    }

    if (getUserId(actor) === getUserId(target)) {
      const accessToken = signAppToken(actor);
      return res.json({ accessToken, user: toClientUser(actor) });
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
    res.json(toClientUser(user, actor));
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
router.post('/users', requireAuth, requireRole('ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const { username, password, displayName, role, empId } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const result = await wfQuery(
      `INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId)
       OUTPUT inserted.Id, inserted.Username, inserted.DisplayName, inserted.Role
       VALUES (@u, @h, @d, @r, @e)`,
      {
        u: { type: sql.NVarChar(50), value: username },
        h: { type: sql.NVarChar(255), value: hash },
        d: { type: sql.NVarChar(100), value: displayName },
        r: { type: sql.NVarChar(30), value: role },
        e: { type: sql.NVarChar(20), value: empId || null },
      }
    );
    res.json(result.recordset[0]);
  } catch (e) {
    if (e.number === 2627) return res.status(409).json({ message: 'ชื่อผู้ใช้ซ้ำ' });
    if (e.number === 2601) return res.status(409).json({ message: 'พนักงานรหัสนี้ถูกผูกกับผู้ใช้อื่นไปแล้ว' });
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auth/users (ADMIN/MANAGER/ACCOUNTING)
router.get('/users', requireAuth, requireRole('ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const result = await wfQuery(
      `SELECT u.Id, u.Username, u.DisplayName, u.Role, u.EmpId, u.IsActive, u.CreatedAt,
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
    res.json(result.recordset);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/auth/users/:id — แก้ไข ADMIN/MANAGER/ACCOUNTING
router.patch('/users/:id', requireAuth, requireRole('ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const { empId, role, displayName, isActive, password, lineUserId, address, phone, email, idCardNo, taxId, positionCode } = req.body;
    const sets = [];
    const inputs = { id: { type: sql.Int, value: Number(req.params.id) } };
    if (empId !== undefined)       { sets.push('EmpId = @empId');        inputs.empId       = { type: sql.NVarChar(20),  value: empId || null }; }
    // ตำแหน่งในผังองค์กร — ส่งค่าว่างมาเพื่อถอดออกได้ · FK กันรหัสที่ไม่มีจริงอยู่แล้ว
    if (positionCode !== undefined) { sets.push('PositionCode = @pos');   inputs.pos         = { type: sql.VarChar(30),   value: positionCode || null }; }
    if (role !== undefined)        { sets.push('Role = @role');          inputs.role        = { type: sql.NVarChar(30),  value: role }; }
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
      if (Number(req.params.id) !== Number(req.user.sub)) {
        sets.push('MustChangePassword = 1');
      } else {
        sets.push('MustChangePassword = 0');
      }
    }
    if (!sets.length) return res.status(400).json({ message: 'ไม่มีข้อมูลที่จะแก้ไข' });
    sets.push('UpdatedAt = GETUTCDATE()');
    const __r = await wfQuery(
      `UPDATE wf.AppUser SET ${sets.join(', ')} WHERE Id = @id`,
      inputs
    );
    if (!__r.rowsAffected?.[0]) return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
    res.json({ ok: true, id: Number(req.params.id) });
  } catch (e) {
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
router.delete('/users/:id', requireAuth, requireRole('ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ message: 'ไม่สามารถลบบัญชีตัวเองได้' });
    const __r = await wfQuery(
      `DELETE FROM wf.AppUser WHERE Id = @id`,
      { id: { type: sql.Int, value: targetId } }
    );
    if (!__r.rowsAffected[0]) return res.status(404).json({ message: 'ไม่พบรายการที่ระบุ' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
