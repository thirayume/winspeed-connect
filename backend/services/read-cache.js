'use strict';
/** Bounded, database/scope-keyed read cache. A cold entry has one SQL loader, not one per client. */
function createReadCache(maxEntries = 128) {
  const entries = new Map();
  return {
    async get(key, load, { ttl = 30000, force = false } = {}) {
      const current = entries.get(key);
      if (current?.pending) return current.pending;
      if (!force && current && current.expires > Date.now()) return current.value;
      const entry = { expires: 0 };
      // Evict only completed entries; active loads must continue to coalesce.
      if (!entries.has(key) && entries.size >= maxEntries) {
        const idle = [...entries].find(([, v]) => !v.pending);
        if (idle) entries.delete(idle[0]);
        else return load(); // bounded storage under many distinct scopes
      }
      entries.set(key, entry);
      entry.pending = Promise.resolve().then(load).then(value => {
        if (entries.get(key) === entry) { entry.value = value; entry.expires = Date.now() + ttl; delete entry.pending; }
        return value;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      return entry.pending;
    },
    clear() { entries.clear(); },
  };
}
function scopedReadKey(target, database, scope) {
  return JSON.stringify([target, database, Boolean(scope.all), scope.basis || '',
    [...new Set(scope.userIds || [])].map(String).sort(), [...new Set(scope.empIds || [])].map(String).sort()]);
}
module.exports = { createReadCache, scopedReadKey };
