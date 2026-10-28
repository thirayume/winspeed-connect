'use strict';

// Exact, reviewed simulation targets. This allowlist has no env override and
// deliberately excludes both live R740 company databases.
const TARGETS = Object.freeze([
  Object.freeze({ server: 'AMYOU-YOGA7\\V2008R2', database: 'dbwins_worldfert9_uat2', id: 10 }),
  Object.freeze({ server: 'R740-SRV\\SQL2008', database: 'dbwins_worldfert9_uat', id: 10 }),
]);

function isInitialNativeUatTarget(record) {
  return Boolean(record && TARGETS.some(target => record.ServerName === target.server
    && record.DbName === target.database && Number(record.DbId) === target.id));
}

module.exports = { isInitialNativeUatTarget };
