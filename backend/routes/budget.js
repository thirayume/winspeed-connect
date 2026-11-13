const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

// GET /api/budget/expenditure
router.get('/expenditure', requireRole('ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'), async (req, res) => {
  try {
    const { year, channel } = req.query;
    const start = (await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
    // Annual plans can use BE years; older giveaway budgets can use CE years.
    // Retain the year containing the cutoff, since the annual totals may carry
    // activity from earlier in that year. This filters display, not the view's
    // underlying spent/remaining arithmetic.
    let where = 'WHERE CASE WHEN PeriodYear BETWEEN 2400 AND 3000 THEN PeriodYear-543 ELSE PeriodYear END >= @startYear';
    const inputs = { startYear: { type: sql.Int, value: Number(start.slice(0, 4)) } };

    if (year) {
      where += ' AND PeriodYear = @year';
      inputs.year = { type: sql.Int, value: Number(year) };
    }
    if (channel) {
      where += ' AND Channel = @channel';
      inputs.channel = { type: sql.NVarChar(30), value: channel };
    }

    const result = await wfQuery(`
      SELECT *
      FROM wf.v_BudgetPlanRegion
      ${where}
      ORDER BY PeriodYear DESC, Region, PlanSection
    `, inputs);

    res.json({ data: camelizeRows(result.recordset || []) });
  } catch (error) {
    console.error('[budget]', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/budget/plans
router.get('/plans', requireRole('ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'), async (req, res) => {
  try {
    const start = (await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
    const result = await wfQuery(`
      SELECT p.*,
             prep.DisplayName AS PreparedByName,
             rev.DisplayName AS ReviewedByName,
             appr.DisplayName AS ApprovedByName
      FROM wf.BudgetPlan p
      LEFT JOIN wf.AppUser prep ON prep.Id = p.PreparedBy
      LEFT JOIN wf.AppUser rev ON rev.Id = p.ReviewedBy
      LEFT JOIN wf.AppUser appr ON appr.Id = p.ApprovedBy
      WHERE CASE WHEN p.PeriodYear BETWEEN 2400 AND 3000 THEN p.PeriodYear-543 ELSE p.PeriodYear END >= @startYear
      ORDER BY p.PeriodYear DESC, p.Channel
    `, { startYear: { type: sql.Int, value: Number(start.slice(0, 4)) } });
    res.json({ data: camelizeRows(result.recordset || []) });
  } catch (error) {
    console.error('[budget]', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
