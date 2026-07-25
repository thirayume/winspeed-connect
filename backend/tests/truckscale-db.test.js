const test = require('node:test');
const assert = require('node:assert/strict');
const { writeBackWeighOutTicket } = require('../services/truckscale-db');

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
