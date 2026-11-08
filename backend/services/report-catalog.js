'use strict';
const { createReadCache } = require('./read-cache');

// Dependencies are injectable so acceptance tests never connect to a live database.
function createReportCatalog(db, reportKeys) {
  const cache = createReadCache(64);
  const known = new Set(reportKeys);
  const invalid = () => Object.assign(new Error('Invalid report catalog configuration'), { status: 400 });
  function validate(payload) {
    if (!Array.isArray(payload?.order) || !payload?.visibility || Array.isArray(payload.visibility) || typeof payload.visibility !== 'object') throw invalid();
    const { order, visibility } = payload;
    if (order.length > known.size || new Set(order).size !== order.length || order.some(k => !known.has(k))) throw invalid();
    if (Object.entries(visibility).some(([k, v]) => !known.has(k) || typeof v !== 'boolean')) throw invalid();
    return { order: [...order, ...reportKeys.filter(k => !order.includes(k))], visibility: Object.fromEntries(reportKeys.map(k => [k, visibility[k] !== false])) };
  }
  async function get() {
    const key = JSON.stringify([db.getTarget(), db.getDbName()]);
    return cache.get(key, async () => {
      const result = await db.wfQuery("SELECT SettingKey, SettingValue FROM wf.SystemSetting WHERE SettingKey LIKE 'REPORT_CFG_%'");
      const items = (result.recordset || []).flatMap(row => {
        const key = row.SettingKey.slice('REPORT_CFG_'.length);
        if (!known.has(key)) return [];
        const value = JSON.parse(row.SettingValue);
        return [{ key, order: Number.isInteger(value.order) ? value.order : 9999, enabled: value.enabled !== false }];
      }).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
      return { order: items.map(i => i.key), visibility: Object.fromEntries(items.map(i => [i.key, i.enabled])) };
    }, { ttl: 15000 });
  }
  async function save(payload, actorId) {
    const config = validate(payload);
    await db.wfTransaction(async tx => {
      // Acquire all setting locks in the same order for concurrent catalog saves.
      for (const key of [...reportKeys].sort()) {
        await new db.sql.Request(tx)
          .input('k', db.sql.NVarChar(50), `REPORT_CFG_${key}`)
          .input('v', db.sql.NVarChar(200), JSON.stringify({ order: config.order.indexOf(key), enabled: config.visibility[key] }))
          .input('d', db.sql.NVarChar(300), `Report catalog config for ${key}`)
          .query(`MERGE wf.SystemSetting WITH (HOLDLOCK) AS t USING (SELECT @k AS SettingKey) AS s ON t.SettingKey=s.SettingKey
            WHEN MATCHED THEN UPDATE SET SettingValue=@v, UpdatedAt=GETUTCDATE()
            WHEN NOT MATCHED THEN INSERT (SettingKey,SettingValue,Description) VALUES (@k,@v,@d);`);
      }
      await new db.sql.Request(tx).input('actor', db.sql.Int, actorId)
        .input('detail', db.sql.NVarChar(db.sql.MAX), JSON.stringify(config))
        .query("INSERT INTO wf.AdminChangeAudit (ActorId,Action,Target,Detail) VALUES (@actor,'REPORT_CATALOG_SAVE','reports',@detail)");
    });
    cache.clear(); // Also invalidates in-flight reads, so an older load cannot repopulate the cache.
    return config;
  }
  return { get, save, validate };
}
module.exports = { createReportCatalog };
