import { ErrorHandler, type EnvironmentProviders, type Provider, inject, provideAppInitializer } from '@angular/core';
import { Router } from '@angular/router';
import * as Sentry from '@sentry/angular';

export interface SpaSentryConfig {
  /** Public DSN. Blank disables reporting entirely. */
  dsn: string;
  /** Which app this is — `web`, `tma`, `admin`, `kds`. */
  app: string;
  /** Build version, so an issue points at an exact deploy. */
  release?: string;
  /** `production` / `staging` / `development`. */
  environment?: string;
}

/**
 * Reads the SPA's Sentry settings off window globals, the same convention
 * the Telegram bot username and the OAuth client ids already use: values
 * live in `index.html`, so staging and prod differ without a rebuild. A
 * browser DSN is public by design.
 *
 * `release` falls back to the version triple that `extract-spa.sh` already
 * writes into `/version.json` and stamps on `window.__BUILD_VERSION`.
 */
export function resolveSpaSentryConfig(app: string): SpaSentryConfig {
  const g = (typeof globalThis === 'undefined' ? {} : globalThis) as {
    __SENTRY_DSN?: string;
    __BUILD_VERSION?: string;
    __SENTRY_ENVIRONMENT?: string;
  };
  return {
    dsn: g.__SENTRY_DSN || '',
    app,
    release: g.__BUILD_VERSION || undefined,
    environment: g.__SENTRY_ENVIRONMENT || undefined,
  };
}

/**
 * Wires Sentry into an Angular app: initialise on bootstrap, route
 * uncaught errors through Sentry's handler, and tag every event with which
 * of the four SPAs it came from so one project can serve all of them.
 *
 * A blank DSN yields providers that do nothing, which is the normal state
 * in local development and in CI — nothing should phone home from there.
 */
export function provideSentry(config: SpaSentryConfig): (Provider | EnvironmentProviders)[] {
  if (!config.dsn) return [];

  return [
    provideAppInitializer(() => {
      Sentry.init({
        dsn: config.dsn,
        release: config.release,
        environment: config.environment,
        // Errors only by default. Tracing and replay are billed per event
        // and neither answers the question this exists to answer, which is
        // "did the checkout throw for a real customer".
        tracesSampleRate: 0,
        initialScope: { tags: { app: config.app } },
        // Extensions and injected scripts generate noise that no one here
        // can act on.
        ignoreErrors: ['ResizeObserver loop', 'Non-Error promise rejection captured'],
        beforeSend(event) {
          return stripQueryStrings(event);
        },
      });
      // Attach the router so breadcrumbs show which screen the error came
      // from — "it broke on checkout" is most of a bug report.
      Sentry.setTag('router', 'angular');
      inject(Router);
    }),
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
  ];
}

/**
 * URLs in this app can carry an order's QR token or a password-reset token
 * in the query string. Those are credentials; they must not land in a
 * third-party dashboard.
 */
function stripQueryStrings(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) {
    event.request.url = event.request.url.split('?')[0];
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.data?.['to'] === 'string') {
      crumb.data['to'] = (crumb.data['to'] as string).split('?')[0];
    }
    if (typeof crumb.data?.['from'] === 'string') {
      crumb.data['from'] = (crumb.data['from'] as string).split('?')[0];
    }
  }
  return event;
}
