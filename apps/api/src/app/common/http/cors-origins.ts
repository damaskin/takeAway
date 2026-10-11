/**
 * Which browser origins may call the API (and open a long-polling socket)
 * with credentials.
 *
 * `CORS_ALLOWED_ORIGINS` (comma-separated) names them. Unset, the API used to
 * reflect *any* origin with credentials, so a page anywhere could call it in a
 * signed-in browser's name; now it falls back to the production sites, and
 * outside production also to any `localhost` / `127.0.0.1` port, where the
 * SPAs run on four of them.
 *
 * Requests without an `Origin` header — the mobile apps, the bank's
 * server-to-server callbacks, curl — are not cross-origin requests at all and
 * are unaffected. Every SPA calls `/api` on its own origin, Telegram's webview
 * included, so production traffic never depends on CORS either; the list is
 * what a *foreign* page gets refused.
 */
export const DEFAULT_PRODUCTION_ORIGINS: readonly string[] = [
  'https://takeaway.md',
  'https://www.takeaway.md',
  'https://admin.takeaway.md',
  'https://kds.takeaway.md',
  'https://tma.takeaway.md',
];

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

type Env = Record<string, string | undefined>;

export function allowedCorsOrigins(env: Env = process.env): string[] {
  const configured = (env['CORS_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return configured.length > 0 ? configured : [...DEFAULT_PRODUCTION_ORIGINS];
}

export function isAllowedOrigin(origin: string | undefined, env: Env = process.env): boolean {
  if (!origin) return true;
  if (allowedCorsOrigins(env).includes(origin)) return true;
  return env['NODE_ENV'] !== 'production' && LOCAL_ORIGIN.test(origin);
}

type OriginCallback = (err: Error | null, allow: boolean) => void;

/**
 * The `origin` option for both @fastify/cors and socket.io's `cors`: the same
 * `(origin, callback)` shape. A refused origin gets no CORS headers — the
 * browser then keeps the response from the page — rather than an error.
 */
export function corsOriginCheck(env: Env = process.env): (origin: string | undefined, cb: OriginCallback) => void {
  return (origin, cb) => cb(null, isAllowedOrigin(origin, env));
}
