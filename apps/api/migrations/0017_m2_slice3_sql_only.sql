-- M2 slice 3's objects that Drizzle's schema cannot express (docs/12 §3).
-- Custom migration: drizzle-kit does not track these, so a later change to any of
-- them is another custom migration.

-- Trigram search on the MEXT catalogue's names (docs/04 `reference_food`). pg_trgm
-- is a trusted extension, so the owner role creates it with its CREATE on the
-- database; Neon supports it on Postgres 18 (version 1.6, checked 2026-10-16).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX reference_food_name_trgm_idx ON reference_food USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX reference_food_name_en_trgm_idx ON reference_food USING gin (name_en gin_trgm_ops);
--> statement-breakpoint

-- The catalogue is shared and read-only to the app: only a migration changes it.
REVOKE INSERT, UPDATE, DELETE ON reference_food FROM overload_app;
--> statement-breakpoint

-- One food per barcode, or per MEXT code, on the list: archived foods do not count,
-- so a food archived and added again is a new row (docs/07 §4).
CREATE UNIQUE INDEX food_user_id_source_ref_key
  ON food (user_id, (source = 'mext'), source_ref)
  WHERE archived_at IS NULL AND source_ref IS NOT NULL;
--> statement-breakpoint

-- One food of a name, brand and state on the list, whatever the case.
CREATE UNIQUE INDEX food_user_id_name_key
  ON food (user_id, lower(name), lower(coalesce(brand, '')), state)
  WHERE archived_at IS NULL;
