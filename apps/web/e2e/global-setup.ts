import { E2E_EMAIL, apiFixture, migrateTestDatabase } from './fixture';

// One user for the run. Each test mints its own session, so signing out in one test cannot sign
// another out.
export default function globalSetup() {
  migrateTestDatabase();
  const created: { userId: string } = JSON.parse(apiFixture('user', E2E_EMAIL));
  const { userId } = created;
  process.env.E2E_USER_ID = userId;
}
