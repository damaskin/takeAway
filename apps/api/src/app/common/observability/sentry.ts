import * as Sentry from '@sentry/node';

/**
 * Error reporting for the API.
 *
 * Until now the only trace of a production failure was a line in the
 * container's stdout, which nobody reads until a customer complains. This
 * gets the stack, the request and the release in front of someone.
 *
 * Two rules the config below exists to enforce:
 *
 *   1. **No DSN, no Sentry.** Local and CI runs must not phone home, and a
 *      missing DSN is the normal state there — so it is a silent no-op,
 *      not a warning and certainly not a failure.
 *   2. **Never ship a token.** Sentry captures request headers by default;
 *      `Authorization`, `stripe-signature` and our own cookies would land
 *      in a third-party UI. They are stripped on the way out.
 */
export function initSentry(): boolean {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    // Tie an issue to the exact build, using the same triple /health reports.
    release: process.env['BUILD_VERSION'] || undefined,
    // Traces are opt-in and default to off: they are billed per span, and
    // this project needs error visibility long before it needs latency
    // histograms.
    tracesSampleRate: sampleRate('SENTRY_TRACES_SAMPLE_RATE', 0),
    // PII stays out. We send the user id via setUser where it matters, not
    // whole request bodies.
    sendDefaultPii: false,
    beforeSend(event) {
      return redact(event);
    },
  });

  return true;
}

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'stripe-signature', 'x-api-key'];

function redact(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
        headers[key] = '[redacted]';
      }
    }
  }
  // Bodies can carry an ID token, a PIN or a card reference. None of it
  // helps debug a stack trace.
  if (event.request) delete event.request.data;
  return event;
}

function sampleRate(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return fallback;
  return raw;
}
