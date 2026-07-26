const test = require('node:test');
const assert = require('node:assert/strict');
const { writeBackWeighOutTicket, getThaiDateComponents } = require('../services/truckscale-db');

test('getThaiDateComponents calculates correct Buddhist year, OLE date serial, and s_day', () => {
  // Test date: 2026-05-01
  const testDate = new Date(2026, 4, 1, 14, 30, 0); // May 1, 2026
  const comp = getThaiDateComponents(testDate);

  assert.equal(comp.dateStr, '01/05/2569');
  assert.equal(comp.oleDateSerial, 46143);
  assert.equal(comp.sDay, 6905);
  assert.equal(comp.timeStr, '14:30:00');
});

test('writeBackWeighOutTicket handles missing MySQL pool gracefully', async () => {
  // When process.env.MYSQL_HOST is not set or MySQL is unconfigured
  const result = await writeBackWeighOutTicket({
    soId: 'SO99999',
    gross: 35000,
    tare: 12000,
    net: 23000,
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'mysql_not_configured');
});
