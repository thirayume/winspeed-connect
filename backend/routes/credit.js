/**
 * credit.js — FR-003 Credit master / credit hold (wf)
 *   จัดการวงเงิน/สถานะ hold ต่อลูกค้า · ตรวจตอน confirm (ใน so.js)
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { businessIds } = require('../services/business-identity');
const { secondaryCustomerVisible } = require('../services/secondary-customer-scope');
const { readGlobalDataWindow } = require('../services/global-data-window-store');
const { checkCustomerCreditAndAging, parseNullableAgingInput, getCreditAgingPolicyBounds } = require('../services/credit-service');

router.use(requireAuth);

// GET /api/credit/:custId/status — Real-time validation of credit limit & aging balance
router.get('/:custId/status', async (req, res) => {
  try {
    const custId = req.params.custId;
    if (req.user.identityMapping && !await secondaryCustomerVisible(req.user, custId))
      return res.status(404).json({ message: 'ไม่พบลูกค้า' });
    const amount = Number(req.query.amount) || 0;
    const status = await checkCustomerCreditAndAging(custId, amount);
    res.json(status);
  } catch (e) {
    console.error('[credit-status]', e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/credit — รายการลูกค้าที่ตั้ง credit (โดยเฉพาะที่ hold)
router.get('/', async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT c.CustId, c.CustName, c.CreditLimit, c.CreditHold, c.AgingDays, c.Note, u.DisplayName AS UpdatedByName, c.UpdatedAt
      FROM wf.CreditMaster c LEFT JOIN wf.AppUser u ON u.Id=c.UpdatedBy
      ORDER BY c.CreditHold DESC, c.UpdatedAt DESC`);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// Credit policy is current master data; only the change history is date-limited.
router.get('/:custId/history', requireRole('ACCOUNTING', 'MANAGER', 'ADMIN'), async (req, res) => {
  let dataWindow;
  try { dataWindow = await readGlobalDataWindow(); }
  catch { return res.status(503).json({ code:'DATA_WINDOW_UNAVAILABLE', message:'ไม่สามารถอ่านวันเริ่มข้อมูลได้' }); }
  try {
    const r=await wfQuery(`SELECT TOP (100) Id, BeforeState, AfterState, ActorPrimaryId, EffectivePrimaryId,
      ActorBusinessId, EffectiveBusinessId, CreatedAt FROM wf.CreditMasterAudit
      WHERE CustId=@c AND CreatedAt>=@globalStartUtc ORDER BY Id DESC`, {
      c:{type:sql.NVarChar(20),value:String(req.params.custId)},
      globalStartUtc:{type:sql.DateTime2,value:dataWindow.utcInstant},
    });
    res.json(r.recordset || []);
  } catch(e) { console.error('[credit/history]',e); res.status(500).json({message:'โหลดประวัติเครดิตไม่สำเร็จ'}); }
});

// GET /api/credit/:custId — ดูเครดิตลูกค้ารายเดียว
router.get('/:custId', async (req, res) => {
  try {
    const [r, bounds] = await Promise.all([
      wfQuery(`SELECT CustId, CustName, CreditLimit, CreditHold, AgingDays, Note FROM wf.CreditMaster WHERE CustId=@c`,
        { c: { type: sql.NVarChar(20), value: String(req.params.custId) } }),
      getCreditAgingPolicyBounds(),
    ]);
    res.json(r.recordset[0] || {
      CustId: req.params.custId,
      CreditLimit: null,
      CreditHold: false,
      AgingDays: null,
      DefaultAgingDays: bounds.defaultAgingDays,
    });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PUT /api/credit/:custId — ตั้ง/แก้เครดิต (ACCOUNTING/MANAGER/ADMIN)
router.put('/:custId', requireRole('ACCOUNTING', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { custName, creditLimit, creditHold, agingDays, note } = req.body || {};
    const hasAging = agingDays !== undefined;
    const parsedAging = hasAging ? parseNullableAgingInput(agingDays) : null;

    const ids = businessIds(req.user);
    const actorPrimary = Number(req.user.actorSub || req.user.sub);
    const effectivePrimary = Number(req.user.sub);
    if (![ids.actor, ids.effective, actorPrimary, effectivePrimary].every(v => Number.isSafeInteger(v) && v > 0))
      return res.status(401).json({ message: 'ไม่พบผู้ใช้' });
    const result = await wfTransaction(async tx => {
      const tq = async (text, inputs = {}) => {
        const request = tx.request();
        for (const [key, { type, value }] of Object.entries(inputs)) request.input(key, type, value);
        return request.query(text);
      };
      const c = { type: sql.NVarChar(20), value: String(req.params.custId) };
      const exists = await tq('SELECT TOP 1 1 AS ok FROM dbo.EMCust WHERE CustID = @c', { c });
      if (!exists.recordset.length) return { notFound: true };
      const before = (await tq(`SELECT CustName, CreditLimit, CreditHold, AgingDays, Note FROM wf.CreditMaster WITH (UPDLOCK,HOLDLOCK) WHERE CustId=@c`, { c })).recordset[0] || null;
      await tq(`MERGE wf.CreditMaster WITH (HOLDLOCK) AS t USING (SELECT @c AS CustId) AS s ON t.CustId=s.CustId
        WHEN MATCHED THEN UPDATE SET CustName=COALESCE(@n,CustName), CreditLimit=@lim, CreditHold=@hold,
          AgingDays=CASE WHEN @hasAging=1 THEN @aging ELSE t.AgingDays END, Note=@note, UpdatedBy=@u, UpdatedAt=GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (CustId,CustName,CreditLimit,CreditHold,AgingDays,Note,UpdatedBy)
          VALUES (@c,@n,@lim,@hold,@aging,@note,@u);`, {
        c, n:{type:sql.NVarChar(200),value:custName||null}, lim:{type:sql.Decimal(18,2),value:creditLimit??null},
        hold:{type:sql.Bit,value:creditHold?1:0},hasAging:{type:sql.Bit,value:hasAging?1:0},
        aging:{type:sql.Int,value:parsedAging},note:{type:sql.NVarChar(300),value:note||null},u:{type:sql.Int,value:ids.effective},
      });
      await tq(`IF OBJECT_ID('wf.CustomerExt','U') IS NOT NULL
        BEGIN
          IF EXISTS (SELECT 1 FROM wf.CustomerExt WITH (UPDLOCK,HOLDLOCK) WHERE CustID=@c)
            UPDATE wf.CustomerExt SET CreditLimit=@lim, AgingDays=CASE WHEN @hasAging=1 THEN @aging ELSE AgingDays END, UpdatedAt=GETUTCDATE() WHERE CustID=@c;
          ELSE INSERT INTO wf.CustomerExt (CustID,CreditLimit,AgingDays,UpdatedAt)
            VALUES (@c,@lim,@aging,GETUTCDATE());
        END`, {
        c,lim:{type:sql.Decimal(18,2),value:creditLimit??null},hasAging:{type:sql.Bit,value:hasAging?1:0},aging:{type:sql.Int,value:parsedAging},
      });
      const after=(await tq('SELECT CustName, CreditLimit, CreditHold, AgingDays, Note FROM wf.CreditMaster WHERE CustId=@c',{c})).recordset[0];
      if (!after) throw new Error('CREDIT_UPDATE_MISSING');
      await tq(`INSERT INTO wf.CreditMasterAudit (CustId,BeforeState,AfterState,ActorPrimaryId,EffectivePrimaryId,ActorBusinessId,EffectiveBusinessId)
        VALUES (@c,@before,@after,@actorPrimary,@effectivePrimary,@actorBusiness,@effectiveBusiness)`, {
        c,before:{type:sql.NVarChar(sql.MAX),value:before ? JSON.stringify(before) : null},after:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(after)},
        actorPrimary:{type:sql.Int,value:actorPrimary},effectivePrimary:{type:sql.Int,value:effectivePrimary},
        actorBusiness:{type:sql.Int,value:ids.actor},effectiveBusiness:{type:sql.Int,value:ids.effective},
      });
      return {};
    });
    if (result.notFound) return res.status(404).json({ message:'ไม่พบรหัสลูกค้านี้ใน WINSpeed' });

    res.json({ ok: true });
  } catch (e) { if(e.code === 'IDENTITY_BINDING_INVALID') return res.status(409).json({code:e.code}); console.error('[credit/update]',e); res.status(500).json({ message:'บันทึกเครดิตไม่สำเร็จ' }); }
});

module.exports = router;
