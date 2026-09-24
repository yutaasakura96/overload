-- infra/db/bootstrap.sql
--
-- Creates the three database roles. Run ONCE per environment, BEFORE the first
-- migration, as a role that can create roles:
--
--   Neon      pasted into the SQL Editor of each branch, as the console-created
--             owner role. Run it on `staging` and on `main` SEPARATELY, and only
--             after `staging` has been branched — Neon copies a parent branch's
--             roles AND their passwords into a child at creation.
--   Local/CI  mounted into docker-entrypoint-initdb.d, followed by
--             infra/db/local-passwords.sql.
--
-- This file deliberately sets NO passwords. Neon requires at least 60 bits of
-- entropy on a LOGIN role, and a password committed here would be public. Each
-- environment's passwords are set by a separate ALTER ROLE — generated at
-- provisioning time, typed straight into Vercel, and saved nowhere else.
--
-- Privileges are NOT granted here. The first migration, run as overload_owner,
-- does that with ALTER DEFAULT PRIVILEGES so every future table is covered.
-- See docs/13 §5.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'overload_owner') THEN
    CREATE ROLE overload_owner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'overload_app') THEN
    CREATE ROLE overload_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'overload_backup') THEN
    CREATE ROLE overload_backup LOGIN;
  END IF;
END
$$;

-- overload_owner owns the schema and every table in it. dbmate connects as this
-- role, so it must be able to create objects before the first migration runs.
GRANT CREATE ON SCHEMA public TO overload_owner;
GRANT USAGE  ON SCHEMA public TO overload_owner, overload_app, overload_backup;

-- Deliberately NOT here: ALTER SCHEMA public OWNER TO overload_owner. On Neon
-- the console-created role cannot SET ROLE overload_owner, so Postgres refuses
-- to hand it ownership (SQLSTATE 42501). It is also unnecessary — dbmate
-- connects as overload_owner, so every table it creates is owned by it, and
-- GRANT CREATE above is all it needs. Found 2026-09-24, first run.
