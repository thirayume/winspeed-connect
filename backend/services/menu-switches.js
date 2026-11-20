'use strict';
// Menu switches (owner, 20 Nov 2026): an ADMIN turns any menu off without a code change while the business decides
// which menus stay. A switched-off menu disappears for everyone except ADMIN, who still sees it to switch it back.
// Reports are switched separately in the report catalog (services/report-catalog.js). Stored in wf.SystemSetting as
// MENU_CFG_<menu> = {"enabled":false}, one row per menu, like the report catalog.
const { createReadCache } = require('./read-cache');

// Menus that keep the system manageable are never switched off.
const ALWAYS_ON = Object.freeze(['dashboard', 'app-settings', 'admin', 'roles']);

function createMenuSwitches(db, menuKeys) {
  const cache = createReadCache(16);
  const switchable = menuKeys.filter(k => !ALWAYS_ON.includes(k));
  const known = new Set(switchable);
  const invalid = () => Object.assign(new Error('รายการเมนูไม่ถูกต้อง'), { status: 400 });

  function validate(payload) {
    const disabled = payload?.disabled;
    if (!Array.isArray(disabled) || new Set(disabled).size !== disabled.length) throw invalid();
    if (disabled.some(k => typeof k !== 'string' || !known.has(k))) throw invalid();
    return { disabled: switchable.filter(k => disabled.includes(k)) };
  }

  async function get() {
    const key = JSON.stringify([db.getTarget(), db.getDbName()]);
    return cache.get(key, async () => {
      const result = await db.wfQuery("SELECT SettingKey, SettingValue FROM wf.SystemSetting WHERE SettingKey LIKE 'MENU_CFG_%'");
      const disabled = [];
      for (const row of result.recordset || []) {
        const menu = row.SettingKey.slice('MENU_CFG_'.length);
        if (!known.has(menu)) continue;
        try { if (JSON.parse(row.SettingValue).enabled === false) disabled.push(menu); } catch { /* a bad row reads as on */ }
      }
      return { disabled: switchable.filter(k => disabled.includes(k)) };
    }, { ttl: 15000 });
  }

  async function save(payload, actorId) {
    const config = validate(payload);
    await db.wfTransaction(async tx => {
      for (const menu of [...switchable].sort()) {
        await new db.sql.Request(tx)
          .input('k', db.sql.NVarChar(50), `MENU_CFG_${menu}`)
          .input('v', db.sql.NVarChar(200), JSON.stringify({ enabled: !config.disabled.includes(menu) }))
          .input('d', db.sql.NVarChar(300), `Menu switch for ${menu}`)
          .query(`MERGE wf.SystemSetting WITH (HOLDLOCK) AS t USING (SELECT @k AS SettingKey) AS s ON t.SettingKey=s.SettingKey
            WHEN MATCHED THEN UPDATE SET SettingValue=@v, UpdatedAt=GETUTCDATE()
            WHEN NOT MATCHED THEN INSERT (SettingKey,SettingValue,Description) VALUES (@k,@v,@d);`);
      }
      await new db.sql.Request(tx).input('actor', db.sql.Int, actorId)
        .input('detail', db.sql.NVarChar(db.sql.MAX), JSON.stringify(config))
        .query("INSERT INTO wf.AdminChangeAudit (ActorId,Action,Target,Detail) VALUES (@actor,'MENU_SWITCH_SAVE','menus',@detail)");
    });
    cache.clear();
    return config;
  }

  /** Capabilities as the user should see them: switched-off menus removed, except for ADMIN. */
  async function apply(capabilities, isAdmin) {
    if (!capabilities || !Array.isArray(capabilities.menus)) return capabilities;
    const { disabled } = await get();
    if (isAdmin) return { ...capabilities, disabledMenus: disabled };
    return { ...capabilities, menus: capabilities.menus.filter(m => !disabled.includes(m)) };
  }

  return { get, save, validate, apply, switchable, ALWAYS_ON };
}

module.exports = { createMenuSwitches, ALWAYS_ON };
