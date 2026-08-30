const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast } = require('../services/socket');

router.use(requireAuth);

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

// GET /api/trips
router.get('/', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { status, search } = req.query;
    let where = 'WHERE 1=1';
    const inputs = {};
    if (status) {
      where += ' AND Status = @status';
      inputs.status = { type: sql.VarChar(50), value: status };
    }
    if (search) {
      where += ' AND (TripCode LIKE @search OR TransRegistration LIKE @search OR DriverName LIKE @search)';
      inputs.search = { type: sql.NVarChar(100), value: `%${search}%` };
    }

    const result = await wfQuery(`
      SELECT t.*, u.DisplayName AS CreatedByName,
             (SELECT COUNT(*) FROM wf.SalesOrder WHERE TripId = t.TripId) as OrderCount
      FROM wf.SalesTrip t
      LEFT JOIN wf.AppUser u ON u.Id = t.CreatedBy
      ${where}
      ORDER BY t.CreatedAt DESC
    `, inputs);

    res.json({ data: camelizeRows(result.recordset || []) });
  } catch (error) {
    console.error('[trips]', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/trips/:id
router.get('/:id', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const trip = await wfQuery(`SELECT * FROM wf.SalesTrip WHERE TripId = @id`, {
      id: { type: sql.Int, value: req.params.id }
    });
    if (!trip.recordset[0]) return res.status(404).json({ message: 'ไม่พบ Trip นี้' });

    const orders = await wfQuery(`
      SELECT Id, WfRef, SoPrefix, CustName, TruckPlate, Status, CreatedAt
      FROM wf.SalesOrder
      WHERE TripId = @id
    `, { id: { type: sql.Int, value: req.params.id } });

    const data = camelizeRow(trip.recordset[0]);
    data.orders = camelizeRows(orders.recordset || []);
    res.json(data);
  } catch (error) {
    console.error('[trips]', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/trips
router.post('/', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { tripCode, transRegistration, driverName, truckCapacityTon, orderIds } = req.body;
    if (!tripCode) return res.status(400).json({ message: 'กรุณาระบุ TripCode' });

    await wfTransaction(async tx => {
      const tripReq = tx.request();
      tripReq.input('tripCode', sql.VarChar(50), tripCode);
      tripReq.input('transRegistration', sql.VarChar(50), transRegistration || null);
      tripReq.input('driverName', sql.VarChar(100), driverName || null);
      tripReq.input('truckCapacityTon', sql.Decimal(18,2), truckCapacityTon || null);
      tripReq.input('createdBy', sql.Int, req.user.sub);

      const tripRes = await tripReq.query(`
        INSERT INTO wf.SalesTrip (TripCode, TransRegistration, DriverName, TruckCapacityTon, CreatedBy)
        OUTPUT inserted.TripId
        VALUES (@tripCode, @transRegistration, @driverName, @truckCapacityTon, @createdBy)
      `);
      const tripId = tripRes.recordset[0].TripId;

      if (orderIds && orderIds.length > 0) {
        for (const orderId of orderIds) {
          const soReq = tx.request();
          soReq.input('tripId', sql.Int, tripId);
          soReq.input('soId', sql.Int, orderId);
          await soReq.query(`UPDATE wf.SalesOrder SET TripId = @tripId WHERE Id = @soId`);
        }
      }
    });

    res.json({ message: 'สร้าง Trip สำเร็จ' });
  } catch (error) {
    console.error('[trips]', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/trips/:id
router.put('/:id', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { transRegistration, driverName, truckCapacityTon, orderIds } = req.body;
    
    await wfTransaction(async tx => {
      const tripReq = tx.request();
      tripReq.input('tripId', sql.Int, req.params.id);
      tripReq.input('transRegistration', sql.VarChar(50), transRegistration || null);
      tripReq.input('driverName', sql.VarChar(100), driverName || null);
      tripReq.input('truckCapacityTon', sql.Decimal(18,2), truckCapacityTon || null);

      await tripReq.query(`
        UPDATE wf.SalesTrip
        SET TransRegistration = @transRegistration,
            DriverName = @driverName,
            TruckCapacityTon = @truckCapacityTon
        WHERE TripId = @tripId
      `);

      // Clear existing links
      await tx.request().input('tripId', sql.Int, req.params.id)
        .query(`UPDATE wf.SalesOrder SET TripId = NULL WHERE TripId = @tripId`);

      // Re-link
      if (orderIds && orderIds.length > 0) {
        for (const orderId of orderIds) {
          const soReq = tx.request();
          soReq.input('tripId', sql.Int, req.params.id);
          soReq.input('soId', sql.Int, orderId);
          await soReq.query(`UPDATE wf.SalesOrder SET TripId = @tripId WHERE Id = @soId`);
        }
      }
    });

    res.json({ message: 'อัปเดต Trip สำเร็จ' });
  } catch (error) {
    console.error('[trips]', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
