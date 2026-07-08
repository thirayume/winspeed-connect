const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole, SECRET } = require('../middleware/auth');

const LINE_AUTH_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';

function appUserPayload(user) {
  return { sub: user.Id, username: user.Username, role: user.Role, displayName: user.DisplayName };
}

function signAppToken(user) {
  return jwt.sign(appUserPayload(user), SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
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
      `SELECT Id, Username, PasswordHash, DisplayName, Role, IsActive FROM wf.AppUser WHERE Username = @u`,
      { u: { type: sql.NVarChar(50), value: username } }
    );
    const user = rows.recordset?.[0];
    if (!user || !user.IsActive) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const valid = await bcrypt.compare(password, user.PasswordHash);
    if (!valid) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const token = signAppToken(user);
    res.json({
      accessToken: token,
      user: { id: user.Id, username: user.Username, displayName: user.DisplayName, role: user.Role },
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
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.channelId,
    redirect_uri: cfg.callbackUrl,
    state: encodeLineState(),
    scope: 'profile openid',
  });
  res.redirect(`${LINE_AUTH_URL}?${params.toString()}`);
});

// GET /api/auth/line/callback
router.get('/line/callback', async (req, res) => {
  const cfg = lineLoginConfig();
  try {
    if (!cfg.channelId || !cfg.channelSecret) throw new Error('LINE Login is not configured');
    if (req.query.error) {
      return res.redirect(appendHash(cfg.successRedirect, { line_error: String(req.query.error_description || req.query.error) }));
    }
    decodeLineState(req.query.state);
    const code = String(req.query.code || '');
    if (!code) throw new Error('missing LINE code');

    const tokenRes = await fetch(LINE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.callbackUrl,
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
      return res.redirect(appendHash(cfg.successRedirect, {
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

    res.redirect(appendHash(cfg.successRedirect, { line_token: signAppToken(user) }));
  } catch (e) {
    console.error('[line-login]', e.message);
    res.redirect(appendHash(cfg.successRedirect, { line_error: e.message || 'line_login_failed' }));
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
      user: { id: user.Id, username: user.Username, displayName: user.DisplayName, role: user.Role },
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

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => res.json(req.user));

// POST /api/auth/users (ADMIN only)
router.post('/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
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

// GET /api/auth/users (ADMIN only)
router.get('/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await wfQuery(
      `SELECT u.Id, u.Username, u.DisplayName, u.Role, u.EmpId, u.IsActive, u.CreatedAt,
              u.LineUserId, u.LineDisplayName, u.LineLinkedAt,
              e.EmpCode, e.EmpName
       FROM wf.AppUser u
       LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpID = u.EmpId
       ORDER BY u.DisplayName`
    );
    res.json(result.recordset);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/auth/users/:id — แก้ไข (map EmpId, role, displayName, active) ADMIN only
router.patch('/users/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { empId, role, displayName, isActive, password, lineUserId } = req.body;
    const sets = [];
    const inputs = { id: { type: sql.Int, value: Number(req.params.id) } };
    if (empId !== undefined)       { sets.push('EmpId = @empId');        inputs.empId       = { type: sql.NVarChar(20),  value: empId || null }; }
    if (role !== undefined)        { sets.push('Role = @role');          inputs.role        = { type: sql.NVarChar(30),  value: role }; }
    if (displayName !== undefined) { sets.push('DisplayName = @dn');      inputs.dn          = { type: sql.NVarChar(100), value: displayName }; }
    if (isActive !== undefined)    { sets.push('IsActive = @act');       inputs.act         = { type: sql.Bit,          value: isActive ? 1 : 0 }; }
    if (lineUserId !== undefined)  {
      sets.push('LineUserId = @lineUserId');
      sets.push('LineLinkedAt = CASE WHEN @lineUserId IS NULL THEN NULL ELSE COALESCE(LineLinkedAt, GETUTCDATE()) END');
      inputs.lineUserId = { type: sql.NVarChar(80), value: lineUserId || null };
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      sets.push('PasswordHash = @ph');
      inputs.ph = { type: sql.NVarChar(255), value: hash };
    }
    if (!sets.length) return res.status(400).json({ message: 'ไม่มีข้อมูลที่จะแก้ไข' });
    sets.push('UpdatedAt = GETUTCDATE()');
    await wfQuery(
      `UPDATE wf.AppUser SET ${sets.join(', ')} WHERE Id = @id`,
      inputs
    );
    res.json({ ok: true, id: Number(req.params.id) });
  } catch (e) {
    if (e.number === 2601) return res.status(409).json({ message: 'พนักงานรหัสนี้ถูกผูกกับผู้ใช้อื่นไปแล้ว' });
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/auth/users/:id — ลบผู้ใช้ (ADMIN only, ห้ามลบตัวเอง)
router.delete('/users/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ message: 'ไม่สามารถลบบัญชีตัวเองได้' });
    await wfQuery(
      `DELETE FROM wf.AppUser WHERE Id = @id`,
      { id: { type: sql.Int, value: targetId } }
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
