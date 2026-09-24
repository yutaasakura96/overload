import { defineConfig, devices } from '@playwright/test';

// The built web app (vite preview, service worker included), the API on Node, and the test
// database, as docs/11 §1 lays out. Ports differ from `pnpm dev` so both can run at once.
export const WEB_PORT = 4174;
export const API_PORT = 8788;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://overload_app:overload_app_dev@localhost:5434/overload_test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  // One user, one database: tests run one at a time.
  workers: 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
  },
  // Chromium and WebKit (docs/11 §1). WebKit is not iOS Safari; the phone checklist is docs/11 §3.
  projects: [
    { name: 'chromium', use: { ...devices['iPhone 15'], browserName: 'chromium' } },
    { name: 'webkit', use: { ...devices['iPhone 15'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @overload/api start',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: process.env.CI === undefined,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: testDatabaseUrl,
        BETTER_AUTH_URL: WEB_ORIGIN,
        // The same test-only values the fixture signs its cookies with (apps/api/test).
        BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
        GOOGLE_CLIENT_ID: 'test-google-client',
        GOOGLE_CLIENT_SECRET: 'test-google-secret',
        ADMIN_EMAIL: 'admin@example.test',
      },
    },
    {
      command: 'pnpm build && pnpm preview',
      url: WEB_ORIGIN,
      reuseExistingServer: process.env.CI === undefined,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}`, PREVIEW_PORT: String(WEB_PORT) },
    },
  ],
});
