-- migrate:up

-- The first migration grants privileges only. The roles themselves come from
-- infra/db/bootstrap.sql, run once per environment before this (docs/13 §5).
-- dbmate connects as overload_owner, so every table it creates is owned by that
-- role, and these defaults reach every table created after this point.

ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO overload_app;
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO overload_app;
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO overload_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO overload_backup;

-- Functions are executable by PUBLIC unless revoked. Each function we write
-- grants EXECUTE to the one role that needs it (purge_audit_events, for one).
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- dbmate made this table before the first migration ran, so the defaults above
-- missed it. The backup reads it so a restore knows which migrations it holds.
GRANT SELECT ON schema_migrations TO overload_backup;

-- migrate:down

REVOKE SELECT ON schema_migrations FROM overload_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  REVOKE SELECT ON SEQUENCES FROM overload_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  REVOKE SELECT ON TABLES FROM overload_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM overload_app;
ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM overload_app;
