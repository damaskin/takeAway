import type { Params } from 'nestjs-pino';

/**
 * Request-log fields that carry credentials. Every request line used to
 * include the caller's bearer token and cookies verbatim — a working session
 * in each log line, copied wherever the logs are shipped. Pino censors these
 * paths before anything is written.
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
];

export function httpLoggerParams(env: NodeJS.ProcessEnv = process.env): Params {
  return {
    pinoHttp: {
      transport:
        env['NODE_ENV'] !== 'production'
          ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
          : undefined,
      level: env['LOG_LEVEL'] ?? 'info',
      autoLogging: true,
      redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' },
    },
  };
}
