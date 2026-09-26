import { createDevSession } from '../../scripts/dev-session-core';
import { testDatabaseUrl } from '../database-urls';
import { testConfig } from '../harness-config';

const stateDirectory = process.argv[2];
if (stateDirectory === undefined) throw new Error('usage: dev-session.ts <state-directory>');

const result = await createDevSession({
  fileValues: {
    DATABASE_URL: testDatabaseUrl,
    BETTER_AUTH_URL: process.env.E2E_WEB_ORIGIN ?? testConfig.webOrigin,
    BETTER_AUTH_SECRET: testConfig.authSecret,
    GOOGLE_CLIENT_ID: testConfig.googleClientId,
    GOOGLE_CLIENT_SECRET: testConfig.googleClientSecret,
    ADMIN_EMAIL: testConfig.adminEmail,
  },
  exportedEnv: {},
  stateDirectory,
  databaseName: 'overload_test',
});
console.log(JSON.stringify(result));
