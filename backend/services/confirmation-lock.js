'use strict';
// Keep the coordination lock on a pinned physical connection. Business queries
// use their existing transactions; this does not make confirmation fully atomic.
async function acquireConfirmationLock(pool, sql, resource) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('resource', sql.NVarChar(255), resource)
      .query(`
        DECLARE @result int;
        EXEC @result = sys.sp_getapplock @Resource=@resource,
          @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
        IF @result < 0
          RAISERROR('[ERR:50002] Unable to acquire lock for SO confirmation',16,1);
      `);
  } catch (error) {
    try { await transaction.rollback(); } catch (_) {}
    throw error;
  }
  let released = false;
  return async function release() {
    if (released) return;
    await transaction.rollback();
    released = true;
  };
}
module.exports = { acquireConfirmationLock };
