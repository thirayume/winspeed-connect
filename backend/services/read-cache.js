'use strict';
/** Bounded, database/scope-keyed read cache. A cold entry has one SQL loader, not one per client. */
function createReadCache(maxEntries = 128) {
  const entries = new Map();
  return {
    // staleMs: after expiry, keep answering with the last value for up to this long while one background load
    // refreshes it (18 Nov 2026: a dashboard waiting 30 s on a refresh looked locked). force always waits.
    async get(key, load, { ttl = 30000, force = false, staleMs = 0 } = {}) {
      const current = entries.get(key);
      if (current?.pending && !current.hasValue) return current.pending;
      const now = Date.now();
      if (!force && current?.hasValue && current.expires > now) return current.value;
      if (!force && staleMs > 0 && current?.hasValue && current.expires + staleMs > now) {
        if (!current.refreshing) {
          current.refreshing = Promise.resolve().then(load).then(value => {
            if (entries.get(key) === current) { current.value = value; current.expires = Date.now() + ttl; }
          }, () => { /* keep serving the last value; the next read retries */ }).then(() => { current.refreshing = null; });
        }
        return current.value;
      }
      const entry = { expires: 0 };
      // Evict only completed entries; active loads must continue to coalesce.
      if (!entries.has(key) && entries.size >= maxEntries) {
        const idle = [...entries].find(([, v]) => !v.pending);
        if (idle) entries.delete(idle[0]);
        else return load(); // bounded storage under many distinct scopes
      }
      entries.set(key, entry);
      entry.pending = Promise.resolve().then(load).then(value => {
        if (entries.get(key) === entry) { entry.value = value; entry.hasValue = true; entry.expires = Date.now() + ttl; delete entry.pending; }
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
