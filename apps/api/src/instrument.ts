/**
 * Sentry bootstrap, in its own module so it runs before anything else.
 *
 * This matters more than it looks: Sentry instruments HTTP, Postgres and
 * Redis by monkey-patching them at require time, and any module evaluated
 * before it keeps the unpatched copy. Imports execute in source order, so
 * `import './instrument'` as the first line of main.ts is what guarantees
 * the patch lands first — calling initSentry() from inside main.ts would
 * not, because every other import is evaluated before the first statement.
 */
import { initSentry } from './app/common/observability/sentry';

export const sentryEnabled = initSentry();
