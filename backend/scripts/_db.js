const { sql, pools, DEFAULT_TARGET } = require('../db');

async function getReadPool(target = DEFAULT_TARGET) {
  const entry = pools(target);
  await entry.ready;
  return entry.readerPool;
}

async function closePools(target = DEFAULT_TARGET) {
  const entry = pools(target);
  await Promise.allSettled([
    entry.readerPool.close(),
    entry.ownerPool.close(),
  ]);
}

module.exports = {
  sql,
  getReadPool,
  closePools,
};
