const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole, SECRET } = require('../middleware/auth');

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

    const token = jwt.sign(
      { sub: user.Id, username: user.Username, role: user.Role, displayName: user.DisplayName },
      SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    res.json({
      accessToken: token,
      user: { id: user.Id, username: user.Username, displayName: user.DisplayName, role: user.Role },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
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
    const { empId, role, displayName, isActive, password } = req.body;
    const sets = [];
    const inputs = { id: { type: sql.Int, value: Number(req.params.id) } };
    if (empId !== undefined)       { sets.push('EmpId = @empId');        inputs.empId       = { type: sql.NVarChar(20),  value: empId || null }; }
    if (role !== undefined)        { sets.push('Role = @role');          inputs.role        = { type: sql.NVarChar(30),  value: role }; }
    if (displayName !== undefined) { sets.push('DisplayName = @dn');      inputs.dn          = { type: sql.NVarChar(100), value: displayName }; }
    if (isActive !== undefined)    { sets.push('IsActive = @act');       inputs.act         = { type: sql.Bit,          value: isActive ? 1 : 0 }; }
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
