-- The first migration grants privileges only. The roles themselves come from
-- infra/db/bootstrap.sql, run once per environment before this (docs/13 §5).
-- drizzle-kit connects as overload_owner, so every table it creates is owned by
-- that role, and these defaults reach every table created after this point.
-- Custom migration: Drizzle's schema has no grants (docs/12 §3).

ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO overload_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO overload_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO overload_backup;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO overload_backup;
--> statement-breakpoint

-- Functions are executable by PUBLIC unless revoked. Each function we write
-- grants EXECUTE to the one role that needs it (purge_audit_events, for one).
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint

-- The migrator made its bookkeeping table before the first migration ran, so the
-- defaults above missed it. The backup reads it so a restore knows which
-- migrations it holds. The app role gets nothing on it.
GRANT SELECT ON __drizzle_migrations TO overload_backup;
