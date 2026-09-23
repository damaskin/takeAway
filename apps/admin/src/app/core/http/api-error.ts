/**
 * Reading a failed API call. Nest answers with `{ statusCode, message }`,
 * where `message` is one string or — from the validation pipe — an array of
 * them, one per broken rule ("phone must be …"). Coded conflicts add a
 * stable `code` that the pages translate instead of showing the English
 * server text.
 */
interface ErrorBody {
  message?: unknown;
  code?: unknown;
}

function bodyOf(err: unknown): ErrorBody | null {
  const body = (err as { error?: unknown } | null)?.error;
  return body && typeof body === 'object' ? (body as ErrorBody) : null;
}

/** The `code` of a coded error (e.g. `EMAIL_TAKEN`), or null. */
export function apiErrorCode(err: unknown): string | null {
  const code = bodyOf(err)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * The properties a validation error complained about, in order and without
 * repeats. class-validator starts every message with the property name.
 */
export function invalidFields(err: unknown): string[] {
  const message = bodyOf(err)?.message;
  if (!Array.isArray(message)) return [];
  const fields = message
    .filter((m): m is string => typeof m === 'string')
    .map((m) => m.split(/\s/, 1)[0] ?? '')
    .filter(Boolean);
  return [...new Set(fields)];
}

/** The server's own wording, for errors that have no translation of their own. */
export function apiErrorMessage(err: unknown): string | null {
  const message = bodyOf(err)?.message;
  if (typeof message === 'string' && message) return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message.join('; ');
  return null;
}
