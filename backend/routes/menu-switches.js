'use strict';
// Menu switches (owner, 20 Nov 2026): GET for every signed-in user (the screen hides switched-off menus), PUT for ADMIN.
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { hasRole, MENUS } = require('../services/role-capabilities');
const { createMenuSwitches } = require('../services/menu-switches');

const switches = createMenuSwitches(require('../db'), Object.keys(MENUS));
const isAdmin = user => hasRole(user, 'ADMIN');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { disabled } = await switches.get();
    res.json({ disabled, switchable: isAdmin(req.user) ? switches.switchable : undefined, alwaysOn: switches.ALWAYS_ON });
  } catch (e) { console.error('[menu-switches]', e); res.status(500).json({ message: 'อ่านการเปิด/ปิดเมนูไม่สำเร็จ' }); }
});

router.put('/', async (req, res) => {
  try {
    if (!isAdmin(req.user) || req.user.isImpersonating) return res.status(403).json({ message: 'เฉพาะ ADMIN เท่านั้นที่เปิด/ปิดเมนูได้' });
    const saved = await switches.save(req.body, Number(req.user.actorSub || req.user.sub));
    res.json({ ...saved, message: 'บันทึกการเปิด/ปิดเมนูแล้ว' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('[menu-switches]', e); res.status(500).json({ message: 'บันทึกการเปิด/ปิดเมนูไม่สำเร็จ' });
  }
});

router.switches = switches;
module.exports = router;
