'use strict';
// Preload before importing any runtime module. Safe in public checkouts without private docs.
// Hermetic tests: ensure ALLOW_RESTORED_LOCAL_UAT does not leak into offline test suite from .env
delete process.env.ALLOW_RESTORED_LOCAL_UAT;
process.env.ALLOW_RESTORED_LOCAL_UAT = '';

for (const name of ['mssql', 'mssql/msnodesqlv8']) {
  let driver;
  try { driver = require(name); }
  catch (error) {
    if (name === 'mssql/msnodesqlv8' && error.code === 'MODULE_NOT_FOUND') continue;
    throw error;
  }
  driver.ConnectionPool.prototype.connect = function () {
    const error = new Error('OFFLINE_DATABASE_CONNECTION_BLOCKED');
    error.code = 'OFFLINE_DATABASE_CONNECTION_BLOCKED';
    throw error;
  };
}
