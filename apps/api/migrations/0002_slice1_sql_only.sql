-- Slice 1's objects that Drizzle's schema cannot express (docs/12 §3).
-- Custom migration: drizzle-kit does not track these, so a later change to any of
-- them is another custom migration.

-- One name per owner, case-insensitively; seeded exercises (owner NULL) compete
-- with each other. Drizzle's index builder has no NULLS NOT DISTINCT.
CREATE UNIQUE INDEX exercise_owner_user_id_name_key
  ON exercise (owner_user_id, lower(name)) NULLS NOT DISTINCT;
--> statement-breakpoint

-- The default privileges gave the app full DML on audit_event. It may only read
-- and append (docs/13 §7).
REVOKE UPDATE, DELETE ON audit_event FROM overload_app;
--> statement-breakpoint

-- The daily job's only way to delete audit rows: those past a year (docs/13 §7).
CREATE FUNCTION purge_audit_events() RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  WITH purged AS (
    DELETE FROM audit_event WHERE occurred_at < now() - interval '1 year' RETURNING 1
  )
  SELECT count(*) FROM purged;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_audit_events() TO overload_app;
