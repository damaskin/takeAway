/**
 * Where the admin panel lives, for the "list your business" page.
 *
 * Deploys inject `window.__ADMIN_APP_URL` from `ADMIN_APP_URL` (see
 * deploy/scripts/extract-spa.sh). Without it: the admin dev server next to
 * a local storefront, or the `admin.` subdomain of the storefront's host —
 * takeaway.md → admin.takeaway.md.
 */
export function resolveAdminAppUrl(): string {
  const configured = (globalThis as { __ADMIN_APP_URL?: string }).__ADMIN_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const location = (globalThis as { location?: Location }).location;
  if (!location) return 'https://admin.takeaway.md';
  const { protocol, hostname } = location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:4202`;
  return `${protocol}//admin.${hostname.replace(/^www\./, '')}`;
}
