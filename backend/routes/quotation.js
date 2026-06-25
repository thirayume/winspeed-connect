/**
 * quotation.js — ใบเสนอราคา (wf.Quotation + QuotationLine)
 * convert → wf.SalesOrder (DRAFT)
 * ⚠ เขียนเฉพาะ schema wf
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

async function genRef(seqName, prefix) {
  const r = await wfQuery(`SELECT NEXT VALUE FOR wf.${seqName} AS Seq`);
  const seq = String(r.recordset[0].Seq).padStart(6, '0');
  const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
  return `${prefix}${yy}-${seq}`;
}

// GET /api/quotation
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? 'WHERE q.Status = @st' : '';
    const inputs = status ? { st: { type: sql.NVarChar(20), value: status } } : {};
    const r = await wfQuery(`
      SELECT q.*, u.DisplayName AS SalesName
      FROM wf.Quotation q LEFT JOIN wf.AppUser u ON u.Id = q.SalesUserId
      ${where} ORDER BY q.CreatedAt DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/quotation/:id
router.get('/:id', async (req, res) => {
  try {
    const q = (await wfQuery(`SELECT * FROM wf.Quotation WHERE Id=@id`, { id: { type: sql.Int, value: Number(req.params.id) } })).recordset?.[0];
    if (!q) return res.status(404).json({ message: 'ไม่พบใบเสนอราคา' });
    const lines = (await wfQuery(`SELECT * FROM wf.QuotationLine WHERE QuoteId=@id ORDER BY LineNum`, { id: { type: sql.Int, value: q.Id } })).recordset || [];
    res.json({ ...q, lines });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/quotation
router.post('/', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const { custId, custName, validUntil, remark, lines, salesUserId: impersonatedId } = req.body;
    if (!custId || !lines?.length) return res.status(400).json({ message: 'custId และ lines จำเป็น' });
    const quoteNo = await genRef('QuoteRefSeq', 'QT');

    const id = await wfTransaction(async tx => {
      const qr = tx.request();
      qr.input('no', sql.NVarChar(30), quoteNo);
      qr.input('cid', sql.NVarChar(20), custId);
      qr.input('cnm', sql.NVarChar(200), custName || '');
      qr.input('vu', sql.Date, validUntil ? new Date(validUntil) : null);
      qr.input('rm', sql.NVarChar(500), remark || null);
      const actualSalesUserId = (req.user.role === 'ADMIN' && impersonatedId) ? Number(impersonatedId) : req.user.sub;
      qr.input('su', sql.Int, actualSalesUserId);
      const qres = await qr.query(`
        INSERT INTO wf.Quotation (QuoteNo, CustId, CustName, ValidUntil, Remark, SalesUserId, Status)
        OUTPUT inserted.Id VALUES (@no, @cid, @cnm, @vu, @rm, @su, 'DRAFT')`);
      const qid = qres.recordset[0].Id;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]; const lr = tx.request();
        lr.input('q', sql.Int, qid); lr.input('n', sql.Int, i + 1);
        lr.input('gid', sql.NVarChar(20), l.goodId); lr.input('gc', sql.NVarChar(50), l.goodCode || '');
        lr.input('gn', sql.NVarChar(200), l.goodName || '');
        lr.input('qt', sql.Decimal(12,3), Number(l.qtyTon));
        lr.input('pp', sql.Decimal(12,2), Number(l.pricePerTon));
        lr.input('np', sql.Decimal(12,2), Number(l.netPricePerTon) || 0);
        lr.input('ig', sql.Bit, l.isGiveaway ? 1 : 0);
        await lr.query(`INSERT INTO wf.QuotationLine (QuoteId, LineNum, GoodId, GoodCode, GoodName, QtyTon, PricePerTon, NetPricePerTon, IsGiveaway)
          VALUES (@q,@n,@gid,@gc,@gn,@qt,@pp,@np,@ig)`);
      }
      return qid;
    });
    res.json({ id, quoteNo });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/quotation/:id/status
router.patch('/:id/status', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].includes(status))
      return res.status(400).json({ message: 'status ไม่ถูกต้อง' });
    await wfQuery(`UPDATE wf.Quotation SET Status=@s, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { s: { type: sql.NVarChar(20), value: status }, id: { type: sql.Int, value: Number(req.params.id) } });
    res.json({ id: Number(req.params.id), status });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/quotation/:id/convert — สร้าง wf.SalesOrder (DRAFT) จากใบเสนอราคา
router.post('/:id/convert', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const { soPrefix } = req.body;
    const prefix = ['I', 'K', 'AI'].includes(soPrefix) ? soPrefix : 'I';
    const q = (await wfQuery(`SELECT * FROM wf.Quotation WHERE Id=@id`, { id: { type: sql.Int, value: Number(req.params.id) } })).recordset?.[0];
    if (!q) return res.status(404).json({ message: 'ไม่พบใบเสนอราคา' });
    if (q.Status === 'CONVERTED') return res.status(400).json({ message: 'แปลงเป็น SO แล้ว' });
    const lines = (await wfQuery(`SELECT * FROM wf.QuotationLine WHERE QuoteId=@id ORDER BY LineNum`, { id: { type: sql.Int, value: q.Id } })).recordset || [];

    // WfRef pattern เดียวกับ so.js
    const seqR = await wfQuery(`SELECT NEXT VALUE FOR wf.WfRefSeq AS Seq`);
    const seq = String(seqR.recordset[0].Seq).padStart(6, '0');
    const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
    const ref = `WF${yy}${prefix}-${seq}`;

    const soId = await wfTransaction(async tx => {
      const sr = tx.request();
      sr.input('ref', sql.NVarChar(30), ref); sr.input('pfx', sql.NVarChar(5), prefix);
      sr.input('cid', sql.NVarChar(20), q.CustId); sr.input('cnm', sql.NVarChar(200), q.CustName);
      sr.input('rm', sql.NVarChar(500), `จากใบเสนอราคา ${q.QuoteNo}`); sr.input('su', sql.Int, q.SalesUserId);
      const sres = await sr.query(`
        INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Remark, SalesUserId, Status)
        OUTPUT inserted.Id VALUES (@ref,@pfx,@cid,@cnm,@rm,@su,'DRAFT')`);
      const sid = sres.recordset[0].Id;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]; const lr = tx.request();
        lr.input('s', sql.Int, sid); lr.input('n', sql.Int, i + 1);
        lr.input('gid', sql.NVarChar(20), l.GoodId); lr.input('gc', sql.NVarChar(50), l.GoodCode);
        lr.input('gn', sql.NVarChar(200), l.GoodName);
        lr.input('qt', sql.Decimal(12,3), Number(l.QtyTon)); lr.input('qb', sql.Int, Math.round(Number(l.QtyTon) * 20));
        lr.input('pp', sql.Decimal(12,2), Number(l.PricePerTon)); lr.input('np', sql.Decimal(12,2), Number(l.NetPricePerTon));
        lr.input('ig', sql.Bit, l.IsGiveaway ? 1 : 0);
        await lr.query(`INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway)
          VALUES (@s,@n,@gid,@gc,@gn,@qt,@qb,@pp,@np,@ig)`);
      }
      return sid;
    });

    await wfQuery(`UPDATE wf.Quotation SET Status='CONVERTED', ConvertedSoId=@so, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { so: { type: sql.Int, value: soId }, id: { type: sql.Int, value: q.Id } });
    res.json({ quoteId: q.Id, soId, wfRef: ref });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
