-- migrate:up

-- Better Auth 1.7.5's five tables, generated rather than written (docs/12 §3):
--   pnpm dlx auth@1.7.5 generate --config scripts/auth-schema.ts --adapter kysely
-- run against local Docker Postgres after 20260924000001, and pasted here unchanged.
-- The snake_case names come from src/auth/snake-case-schema.ts, not from `casing`
-- (docs/06, 2026-09-24). On a Better Auth upgrade, the next diff is a new migration.

create table "user" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "email" text not null unique, "email_verified" boolean not null, "image" text, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz default CURRENT_TIMESTAMP not null);

create table "session" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expires_at" timestamptz not null, "token" text not null unique, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz not null, "ip_address" text, "user_agent" text, "user_id" uuid not null references "user" ("id") on delete cascade);

create table "account" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "account_id" text not null, "provider_id" text not null, "user_id" uuid not null references "user" ("id") on delete cascade, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamptz, "refresh_token_expires_at" timestamptz, "scope" text, "password" text, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz not null);

create table "verification" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expires_at" timestamptz not null, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz default CURRENT_TIMESTAMP not null);

create table "rate_limit" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "key" text not null unique, "count" integer not null, "last_request" bigint not null);

create index "session_user_id_idx" on "session" ("user_id");

create index "account_user_id_idx" on "account" ("user_id");

create index "verification_identifier_idx" on "verification" ("identifier");

-- migrate:down

drop table "rate_limit";
drop table "verification";
drop table "account";
drop table "session";
drop table "user";
