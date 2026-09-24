-- migrate:up

-- Slice 1's own tables (docs/04, "When each table is created"): invite,
-- audit_event, user_profile, exercise, exercise_setting. Nothing else.

-- One Google email allowed to sign in (docs/08 §1).
CREATE TABLE invite (
  id                 uuid        NOT NULL DEFAULT uuidv7() PRIMARY KEY,
  email              text        NOT NULL CHECK (email = lower(email)),
  invited_by_user_id uuid        REFERENCES "user" (id) ON DELETE SET NULL,
  note               text,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invite_email_key UNIQUE (email)
);

-- Who did what to access and accounts (docs/13 §7). Append-only; no FKs, so a
-- row outlives the account it names.
CREATE TABLE audit_event (
  id            uuid        NOT NULL DEFAULT uuidv7() PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  action        text        NOT NULL CHECK (action IN (
                  'sign_in', 'sign_out', 'invite_created', 'access_revoked',
                  'access_restored', 'ingest_token_created', 'ingest_token_revoked',
                  'account_deleted', 'admin_action')),
  target_type   text,
  target_id     uuid,
  detail        jsonb,
  ip            inet,
  user_agent    text
);
CREATE INDEX audit_event_actor_user_id_occurred_at_idx ON audit_event (actor_user_id, occurred_at DESC);
CREATE INDEX audit_event_occurred_at_idx ON audit_event (occurred_at);

-- The default privileges gave the app full DML. It may only read and append.
REVOKE UPDATE, DELETE ON audit_event FROM overload_app;

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
GRANT EXECUTE ON FUNCTION purge_audit_events() TO overload_app;

-- One row per user. Created now; the first reader of a field is slice 3.
-- weight_unit is the display preference decided 2026-09-23 (docs/06): weights
-- are stored in kg whatever it says.
CREATE TABLE user_profile (
  user_id           uuid        NOT NULL PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  timezone          text        NOT NULL DEFAULT 'Asia/Tokyo',
  height_cm         numeric(5,1),
  sex               text        CHECK (sex IN ('male', 'female')),
  birth_date        date,
  training_weekdays smallint[]  NOT NULL DEFAULT '{}',
  weight_unit       text        NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg', 'lb')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Seeded (owner_user_id IS NULL) or one user's own (S8). The equipment values
-- are a load-increment taxonomy (docs/06, 2026-09-23).
CREATE TABLE exercise (
  id                   uuid         NOT NULL DEFAULT uuidv7() PRIMARY KEY,
  owner_user_id        uuid         REFERENCES "user" (id) ON DELETE CASCADE,
  name                 text         NOT NULL,
  equipment            text         NOT NULL CHECK (equipment IN (
                         'barbell', 'dumbbell', 'machine_plate', 'machine_stack',
                         'cable', 'bodyweight', 'other')),
  default_increment_kg numeric(5,2) NOT NULL DEFAULT 2.50,
  default_rest_seconds integer      NOT NULL DEFAULT 120,
  default_rep_low      smallint     NOT NULL DEFAULT 6,
  default_rep_high     smallint     NOT NULL DEFAULT 10,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT exercise_rep_range_check CHECK (default_rep_low <= default_rep_high)
);
CREATE UNIQUE INDEX exercise_owner_user_id_name_key
  ON exercise (owner_user_id, lower(name)) NULLS NOT DISTINCT;
CREATE INDEX exercise_owner_user_id_idx ON exercise (owner_user_id);

-- One user's overrides for one exercise; absent means the exercise defaults.
CREATE TABLE exercise_setting (
  user_id      uuid         NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  exercise_id  uuid         NOT NULL REFERENCES exercise (id) ON DELETE CASCADE,
  increment_kg numeric(5,2),
  rest_seconds integer,
  rep_low      smallint,
  rep_high     smallint,
  hidden_at    timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, exercise_id),
  CONSTRAINT exercise_setting_rep_range_check
    CHECK (rep_low IS NULL OR rep_high IS NULL OR rep_low <= rep_high)
);

-- migrate:down

DROP TABLE exercise_setting;
DROP TABLE exercise;
DROP TABLE user_profile;
DROP FUNCTION purge_audit_events();
DROP TABLE audit_event;
DROP TABLE invite;
