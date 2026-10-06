'use strict';
// Initialize each native physical connection before pooling. Separate from user
// batches to preserve CREATE/ALTER first-statement semantics.
const SESSION_SQL = [
  'SET ANSI_NULLS ON', 'SET QUOTED_IDENTIFIER ON', 'SET ANSI_PADDING ON',
  'SET ANSI_WARNINGS ON', 'SET CONCAT_NULL_YIELDS_NULL ON',
  'SET ARITHABORT ON', 'SET NUMERIC_ROUNDABORT OFF',
].join('; ') + ';';
function withNativeSessionSettings(BasePool) {
  return class SessionPool extends BasePool {
    async _poolCreate() {
      const connection = await super._poolCreate();
      try {
        await new Promise((resolve, reject) => {
          connection.query(SESSION_SQL, error => error ? reject(error) : resolve());
        });
        return connection;
      } catch (error) {
        try { await this._poolDestroy(connection); } catch (_) {}
        throw error;
      }
    }
  };
}
module.exports = { SESSION_SQL, withNativeSessionSettings };
