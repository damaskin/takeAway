import type { TranslateService } from '@ngx-translate/core';

/**
 * The body of an API error: Nest's `{ statusCode, message, error }`, where
 * `message` is a list for validation failures, plus a stable `code` on the
 * conflicts the admin can act on (STORE_HAS_ORDERS, …).
 */
export interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  code?: string;
  [key: string]: unknown;
}

/** How a screen words the API's errors. Every value is a translation key. */
export interface ApiErrorWording {
  /** By the `code` of a 409. The body is passed as translation params. */
  codes?: Record<string, string>;
  /** By the exact (English) message of an error that has no code. */
  messages?: Record<string, string>;
  /** By HTTP status, when neither a code nor a message is known. */
  statuses?: Record<number, string>;
  /**
   * Field labels by property name. A validation message starts with the
   * property it is about ("timezone must be …", "hours.0.opensAt must …").
   */
  fields?: Record<string, string>;
  /** "Check the field «{{field}}»" — used with {@link fields}. */
  invalidField?: string;
  /** No answer at all: offline, DNS, CORS. */
  network?: string;
}

/** The parsed error body, or null when the failure never reached the API. */
export function apiErrorBody(err: unknown): ApiErrorBody | null {
  const body = (err as { error?: unknown } | null)?.error;
  return typeof body === 'object' && body !== null ? (body as ApiErrorBody) : null;
}

/** The stable `code` of an error, if the API sent one. */
export function apiErrorCode(err: unknown): string | null {
  const code = apiErrorBody(err)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Readable text for a failed request, in the admin's language where the
 * error is known. Validation failures used to reach people as "Http
 * failure response for … 400 Bad Request", or as the first raw English
 * validator line; an unknown message is still shown as sent, since the
 * real reason beats a generic apology.
 */
export function apiErrorMessage(err: unknown, translate: TranslateService, wording: ApiErrorWording = {}): string {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 0) return translate.instant(wording.network ?? 'common.requestFailed');

  const body = apiErrorBody(err);
  const byStatus = typeof status === 'number' ? wording.statuses?.[status] : undefined;

  const codeKey = body?.code ? wording.codes?.[body.code] : undefined;
  if (codeKey) return translate.instant(codeKey, body ?? undefined);

  const message = body?.message;
  if (Array.isArray(message)) {
    const lines = message
      .filter((m): m is string => typeof m === 'string')
      .map((m) => sentence(describe(m, translate, wording)));
    if (lines.length > 0) return [...new Set(lines)].join(' ');
  }
  if (typeof message === 'string' && message) {
    const known = wording.messages?.[message];
    if (known) return translate.instant(known);
    if (byStatus) return translate.instant(byStatus);
    if (typeof status === 'number' && status >= 500) return translate.instant('common.genericError');
    return message;
  }
  if (byStatus) return translate.instant(byStatus);
  return translate.instant('common.genericError');
}

function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function describe(message: string, translate: TranslateService, wording: ApiErrorWording): string {
  const known = wording.messages?.[message];
  if (known) return translate.instant(known);
  const property = /^([\w.]+) /.exec(message)?.[1];
  if (property && wording.fields && wording.invalidField) {
    const label = wording.fields[property] ?? wording.fields[property.split('.')[0] ?? ''];
    if (label) return translate.instant(wording.invalidField, { field: translate.instant(label) });
  }
  return message;
}
