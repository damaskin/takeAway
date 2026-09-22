import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// The admin dev server listens on 4202 (see apps/admin/project.json).
const baseURL = process.env['BASE_URL'] || 'http://localhost:4202';

export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec nx run admin:serve',
    url: baseURL,
    reuseExistingServer: true,
    cwd: workspaceRoot,
    timeout: 180_000,
  },
  /* Chromium only, for the same reason as web-e2e. */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Honour a browser supplied by the image rather than downloading
        // one — see the note in apps/web-e2e/playwright.config.ts.
        ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
          ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] } }
          : {}),
      },
    },
  ],
});
