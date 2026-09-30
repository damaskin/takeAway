/**
 * The human-readable part of a failed HttpClient call.
 *
 * Nest answers a validation failure with `message` as an array of strings and
 * everything else with a single string, so both shapes turn up in practice.
 * Returns null when the error carries nothing worth showing — the caller knows
 * which of its own messages to fall back to.
 */
export function extractMessage(err: unknown): string | null {
  const maybe = err as { error?: { message?: unknown }; message?: unknown; status?: number };
  const body = maybe.error?.message;
  if (typeof body === 'string' && body.length > 0) return body;
  if (Array.isArray(body) && body.length > 0 && typeof body[0] === 'string') return body[0];
  if (maybe.status === 0) return null;
  if (typeof maybe.message === 'string' && maybe.message.length > 0) return maybe.message;
  return null;
}
