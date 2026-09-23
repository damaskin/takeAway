import type { TranslateService } from '@ngx-translate/core';

/**
 * One sentence for a failed menu request, in the admin's language wherever
 * we know what went wrong: the API's domain `code` first, then a known HTTP
 * status, then the server's own message — class-validator sends an array of
 * them — and only then a generic line. What used to reach the screen was
 * Angular's "Http failure response for … 400 Bad Request", which says
 * nothing to a café owner.
 *
 * `statusKeys` overrides the status translation where the screen knows
 * better (a 503 on a photo upload means storage is not set up).
 */
export function describeMenuError(
  err: unknown,
  translate: TranslateService,
  statusKeys: Partial<Record<number, string>> = {},
): string {
  const { status, error } = (err ?? {}) as { status?: unknown; error?: unknown };
  const body = typeof error === 'object' && error !== null ? (error as { code?: unknown; message?: unknown }) : {};

  const known = (key: string): string | null => {
    const text: unknown = translate.instant(key);
    return typeof text === 'string' && text !== key ? text : null;
  };

  if (typeof body.code === 'string') {
    const text = known(`admin.menu.errors.${body.code}`);
    if (text) return text;
  }
  if (typeof status === 'number') {
    const text = known(statusKeys[status] ?? `admin.menu.errors.status.${status}`);
    if (text) return text;
  }
  const messages = (Array.isArray(body.message) ? body.message : [body.message]).filter(
    (m): m is string => typeof m === 'string' && m.trim().length > 0,
  );
  if (messages.length > 0) return messages.join('; ');
  return translate.instant('admin.menu.errors.generic');
}

/** The API's domain error code, when the failure carries one. */
export function menuErrorCode(err: unknown): string | null {
  const error = (err as { error?: unknown } | null)?.error;
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
