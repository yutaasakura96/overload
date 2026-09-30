-- infra/db/local-test-database.sql
--
-- Local Docker ONLY. Creates `overload_test`, which Vitest and Playwright migrate and use, so a
-- test run never touches the development database. The roles are cluster-wide and already exist;
-- the schema grants in bootstrap.sql are per database, so they are applied here as well.

CREATE DATABASE overload_test;
\connect overload_test
\i /docker-entrypoint-initdb.d/01-bootstrap.sql
