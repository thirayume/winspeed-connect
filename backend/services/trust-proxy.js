'use strict';

/**
 * TRUST_PROXY = how many reverse proxies stand in front of the API (the Compose stacks: Caddy = 1).
 * With it, req.ip and express-rate-limit use the address the nearest proxy saw instead of the proxy
 * itself. Unset or 0 trusts no proxy. Anything else (true, names, lists) is refused: trusting every
 * hop would let a client write its own X-Forwarded-For and choose the address in audit logs.
 */
function trustProxyHops(value, warn = console.warn) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  if (!/^\d{1,2}$/.test(raw)) {
    warn(`[trust-proxy] ignoring TRUST_PROXY="${raw}": set the number of proxies in front of the API`);
    return false;
  }
  const hops = Number(raw);
  return hops > 0 ? hops : false;
}

module.exports = { trustProxyHops };
