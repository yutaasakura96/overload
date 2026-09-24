import type { Config } from '../src/config';
import { testDatabaseUrl } from './database-urls';

// The test configuration, without Vitest, so the browser-test fixture can use it too.
export const WEB_ORIGIN = 'http://localhost:5173';
export const ADMIN_EMAIL = 'admin@example.test';

export const testConfig: Config = {
  databaseUrl: testDatabaseUrl,
  webOrigin: WEB_ORIGIN,
  authSecret: 'test-secret-that-is-at-least-32-characters-long',
  googleClientId: 'test-google-client',
  googleClientSecret: 'test-google-secret',
  adminEmail: ADMIN_EMAIL,
};
