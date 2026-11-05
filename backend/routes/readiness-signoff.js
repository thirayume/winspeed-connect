'use strict';

const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const TOPICS = [
  { code: 'SALES_EMP_MAPPING', title: 'ผูกพนักงานฝ่ายขายและเข้าใช้ครั้งแรก', team: 'ฝ่ายขาย + IT', hint: 'จดผลตรวจ EmpID ใน EMSales และเลขใบจอง 103 ของบัญชีที่ทดสอบ' },
  { code: 'WINSPEED_INVOICE_BOOK', title: 'เลือกเล่ม J และ N ก่อน Post Invoice', team: 'บัญชี', hint: 'จดเมนู ปุ่ม ตัวกรอง และตัวอย่าง 107 ทั้งสองเล่ม' },
  { code: 'WINSPEED_AR', title: 'รายงานลูกหนี้หลังออกตั๋วและใบส่งของ', team: 'บัญชี', hint: 'จดชื่อรายงาน ตัวกรอง และผลเทียบยอดหลัง 202 และ 107' },
  { code: 'WINSPEED_GL', title: 'ตรวจผล Post GL', team: 'บัญชี', hint: 'จดขั้นตรวจและเลขอ้างอิง batch หรือสมุดรายวัน' },
  { code: 'SCALE_TRANSPORT', title: 'ชั่งรถจริงและตรวจใบขน', team: 'คลัง + บัญชี', hint: 'จดขั้นเทียบใบชั่ง ใบขน และเลข 116 ของรอบตรวจ' },
  { code: 'WINSPEED_PRINT', title: 'แบบพิมพ์ WinSpeed และกระดาษจริง', team: 'คลัง + บัญชี', hint: 'จดชื่อแบบ สาขา ขนาดกระดาษ และเลขเอกสารที่ทดสอบ' },
];
const STATUSES = ['PENDING', 'IN_REVIEW', 'CONFIRMED'];
const PAGE_SIZE = 20;
const fields = 'TopicCode, Revision, Status, ProcedureText, EvidenceReference, Reviewer, ReviewDate, SavedByUserId, SavedByUsername, SavedAt';

router.use(requireAuth, requireRole('ADMIN'), (req, res, next) => {
  if (req.user.isImpersonating) {
    return res.status(403).json({ message: 'กรุณาออกจากโหมดทำรายการแทนก่อนเปิดผลตรวจรับ' });
  }
  next();
});

function topicCode(req, res, next) {
  if (!TOPICS.some(topic => topic.code === req.params.topic)) {
    return res.status(404).json({ message: 'ไม่พบหัวข้อตรวจรับ' });
  }
  next();
}

function sendFailure(res, error) {
  console.error('[readiness-signoff]', error.number || error.code || error.name);
  return res.status(500).json({ message: 'อ่านหรือบันทึกผลตรวจรับไม่สำเร็จ' });
}

router.get('/', async (_req, res) => {
  try {
    const result = await wfQuery(
      'WITH Ranked AS (SELECT ' + fields +
      ', ROW_NUMBER() OVER (PARTITION BY TopicCode ORDER BY Revision DESC) AS rn FROM wf.ReadinessSignoff) ' +
      'SELECT DB_NAME() AS DatabaseName, ' + fields + ' FROM (SELECT 1 AS seed) AS Source LEFT JOIN Ranked ON rn=1'
    );
    const byCode = new Map(result.recordset.map(record => [record.TopicCode, record]));
    return res.json({ database: result.recordset[0]?.DatabaseName ?? null, topics: TOPICS.map(topic => ({ ...topic, current: byCode.get(topic.code) ?? null })) });
  } catch (error) {
    return sendFailure(res, error);
  }
});

router.get('/:topic/history', topicCode, async (req, res) => {
  const cursor = req.query.before;
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[1-9]\d{0,9}$/.test(cursor) || Number(cursor) > 2147483647)) {
    return res.status(400).json({ message: 'เลขหน้าประวัติไม่ถูกต้อง' });
  }
  try {
    const result = await wfQuery(
      'SELECT TOP (' + (PAGE_SIZE + 1) + ') ' + fields + ' FROM wf.ReadinessSignoff ' +
      'WHERE TopicCode=@topic AND (@before IS NULL OR Revision < @before) ORDER BY Revision DESC',
      { topic: { type: sql.VarChar(40), value: req.params.topic }, before: { type: sql.Int, value: cursor ? Number(cursor) : null } }
    );
    const items = result.recordset.slice(0, PAGE_SIZE);
    return res.json({ items, nextBefore: result.recordset.length > PAGE_SIZE ? items.at(-1).Revision : null });
  } catch (error) {
    return sendFailure(res, error);
  }
});

function parseChange(body) {
  const { status, expectedRevision, reviewDate, expectedDatabase } = body;
  if (typeof expectedDatabase !== 'string' || !expectedDatabase || expectedDatabase.length > 128) return null;
  if (!STATUSES.includes(status) || !Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 2147483646) return null;
  const values = {};
  for (const [key, limit] of [['procedureText', 1500], ['evidenceReference', 500], ['reviewer', 100]]) {
    if (typeof body[key] !== 'string' || body[key].trim().length > limit) return null;
    values[key] = body[key].trim();
  }
  let date = null;
  if (reviewDate !== null && reviewDate !== '') {
    if (typeof reviewDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || reviewDate.startsWith('0000')) return null;
    date = new Date(reviewDate + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== reviewDate) return null;
  }
  if (status === 'CONFIRMED' && (!values.procedureText || !values.evidenceReference || !values.reviewer || !date)) return null;
  return { status, expectedRevision, expectedDatabase, ...values, date };
}

router.put('/:topic', topicCode, async (req, res) => {
  const input = parseChange(req.body || {});
  if (!input) {
    return res.status(400).json({ message: 'ตรวจสถานะ วันที่ และความยาวของข้อมูล การยืนยันต้องมีขั้นตอน หลักฐาน ชื่อผู้รับรอง และวันที่' });
  }
  const conflict = () => res.status(409).json({ message: 'ฐานข้อมูลหรือผลตรวจรับเปลี่ยนไป กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง' });
  try {
    const result = await wfQuery(
      'INSERT INTO wf.ReadinessSignoff (TopicCode, Revision, Status, ProcedureText, EvidenceReference, Reviewer, ReviewDate, SavedByUserId, SavedByUsername) ' +
      'OUTPUT ' + fields.split(', ').map(field => 'INSERTED.' + field).join(', ') +
      ' SELECT @topic, @revision+1, @status, @procedure, @evidence, @reviewer, @reviewDate, @actorId, @actorName' +
      ' WHERE DB_NAME()=@database AND @revision=ISNULL((SELECT MAX(Revision) FROM wf.ReadinessSignoff WITH (UPDLOCK, HOLDLOCK) WHERE TopicCode=@topic),0)',
      {
        topic: { type: sql.VarChar(40), value: req.params.topic },
        revision: { type: sql.Int, value: input.expectedRevision },
        database: { type: sql.NVarChar(128), value: input.expectedDatabase },
        status: { type: sql.VarChar(12), value: input.status },
        procedure: { type: sql.NVarChar(1500), value: input.procedureText },
        evidence: { type: sql.NVarChar(500), value: input.evidenceReference },
        reviewer: { type: sql.NVarChar(100), value: input.reviewer },
        reviewDate: { type: sql.Date, value: input.date },
        actorId: { type: sql.Int, value: Number(req.user.sub) },
        actorName: { type: sql.NVarChar(50), value: req.user.username || String(req.user.sub) },
      }
    );
    const saved = result.recordset[0];
    return saved ? res.json(saved) : conflict();
  } catch (error) {
    if ([1205, 2601, 2627].includes(error.number)) return conflict();
    return sendFailure(res, error);
  }
});

module.exports = router;
