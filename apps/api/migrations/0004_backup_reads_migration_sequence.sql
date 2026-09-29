-- pg_dump reads every sequence's current value, and 0000 granted the bookkeeping table to the backup
-- role but not the sequence behind its id, which the migrator also made before 0000 ran. Without
-- this the nightly dump stops at that sequence and uploads nothing (docs/13 §2). Found 2026-09-28.
-- Custom migration: Drizzle's schema has no grants (docs/12 §3).

GRANT SELECT ON SEQUENCE __drizzle_migrations_id_seq TO overload_backup;
