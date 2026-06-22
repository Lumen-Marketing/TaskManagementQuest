// @ts-check
import { defineConfig, devices } from '@playwright/test';

const LOCAL_BASE = process.env.LOCAL_BASE_URL || 'http://localhost:4173';
const PREVIEW_BASE = process.env.PREVIEW_BASE_URL || '';

/* Two projects:
   - "local" runs the full critical-path suite against a Node static server
     plus a TEST Supabase project (cred via TEST_* env vars).
   - "preview-smoke" runs a small DB-free subset against the live Vercel
     preview URL (PREVIEW_BASE_URL).
   Each project filters by testMatch so the same suites don't double-run. */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,         // tests touch shared Supabase rows; keep order stable
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  projects: [
    {
      name: 'local',
      testMatch: ['auth.spec.js', 'tasks.spec.js', 'role-gate.spec.js', 'preview-bypass-dead.spec.js', 'add-person.spec.js', 'responsive.spec.js', 'focus-model.spec.js', 'focus-dragorder.spec.js', 'focus-e2e.spec.js', 'hq-time.spec.js', 'redesign-topbar.spec.js', 'home-reports.spec.js'],
      use: {
        baseURL: LOCAL_BASE,
        ...devices['Desktop Chrome'],
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
    },
    {
      name: 'preview-smoke',
      testMatch: ['preview-smoke.spec.js'],
      use: {
        baseURL: PREVIEW_BASE,
        ...devices['Desktop Chrome'],
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
    },
  ],

  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER ? undefined : {
    command: 'node tools/dev-server.mjs',
    url: LOCAL_BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    env: { PORT: String(new URL(LOCAL_BASE).port || 4173) },
  },
});
