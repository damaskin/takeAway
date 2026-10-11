/**
 * What Fastify's `trustProxy` should be, from `TRUST_PROXY`.
 *
 * The API is only ever reached through our own nginx, and nginx replaces
 * `X-Forwarded-For` with one address — the visitor's, from Cloudflare's
 * `CF-Connecting-IP` (deploy/nginx/snippets/api-proxy.conf). So exactly one
 * hop is ours: Fastify takes the right-most entry of the header and stops.
 *
 * `trustProxy: true` used to trust the whole chain, so `request.ip` was the
 * left-most entry — whatever the client typed into its own X-Forwarded-For —
 * and every per-IP rate limit could be dodged by changing it per request.
 *
 *   unset / ''          → 1 (one proxy hop: our nginx)
 *   '0' / 'false'       → false (no proxy; the socket address is the client)
 *   a positive integer  → that many hops
 *   anything else       → a comma-separated list of addresses / CIDRs to trust
 */
export function resolveTrustProxy(raw: string | undefined): boolean | number | string[] {
  const value = raw?.trim() ?? '';
  if (value === '') return 1;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  // `true` is deliberately not accepted: it is the setting this replaced.
  if (value.toLowerCase() === 'true') return 1;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
