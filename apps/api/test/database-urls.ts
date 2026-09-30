// The test database: `overload_test` in the local Docker Postgres, or CI's service container.
// Local never touches Neon. The app role runs the tests; the owner role runs the migrations.
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://overload_app:overload_app_dev@localhost:5434/overload_test';

export const testDatabaseOwnerUrl =
  process.env.TEST_DATABASE_URL_DIRECT ??
  'postgres://overload_owner:overload_owner_dev@localhost:5434/overload_test?sslmode=disable';
