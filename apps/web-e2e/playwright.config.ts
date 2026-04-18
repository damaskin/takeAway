import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'pnpm exec nx run web:serve',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    cwd: workspaceRoot,
    timeout: 120_000,
  },
  /*
   * We intentionally run only Chromium in CI. Firefox/webkit matrix inflates
   * runtime ~3× and currently doesn't catch extra regressions on top of the
   * Angular 21 baseline Chromium already hits. Add them back via a separate
   * nightly workflow if we need per-engine coverage.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
