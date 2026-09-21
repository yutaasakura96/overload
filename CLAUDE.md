# Overload

A weight-training tracker: lift logging, meal planning, Apple Health data, bodyweight coaching.
Invite-only, web app first (installed to the iPhone home screen), native iOS later.

## Read first

- `docs/00-status.md`: where the project is. `CONTEXT.md`: the vocabulary. Use its terms
  (`workout`, not "session") in code, tickets and commits.
- Architecture and stack: @docs/03-technical-design.md. Schema: `docs/04`. API: `docs/07`.
  Auth: `docs/08`. Flows: `docs/09`. Tests: `docs/11`. Deploy: `docs/12`. Security: `docs/13`.
- Design: `docs/05` (tokens) and `docs/10` (screens). The `design/*.dc.html` files are sources.
  `design/overload.html` is generated and gitignored.
- Why something was decided, and what was rejected: `docs/06`. Don't re-propose a rejected option
  without new evidence.

## Commands

The pnpm workspace doesn't exist yet. Add its scripts here once `package.json` lands.

- Local Postgres 18: `docker compose up -d`. Local never touches Neon.
- Migrations: `dbmate --migrations-dir apps/api/migrations migrate`, against Docker only.
  Staging and production migrate inside the API's Vercel build (`docs/12` §3). Never run by hand.

## Branches

`develop` deploys staging. `main` deploys production, and the build runs migrations against
production. Work on `develop` or a feature branch. A hook blocks edits on `main`.

## Binding rules

A linter won't catch these:

- `apps/web` imports `packages/api-contract` only, never `apps/api`.
- `packages/api-contract/openapi.json` and its types are generated from the route schemas. Regenerate
  them; never edit them by hand. Breaking changes fail CI (oasdiff) unless the PR carries the label.
- Every query in `apps/api/src/db/` takes the session user. Routes never filter by user themselves.
  Every resource gets a cross-user test (`docs/08` §10).
- Planner, progression, trend, expenditure and plateau logic are pure functions in
  `apps/api/src/domain/`, never in the web app.
- Rows created on the device carry a client-made UUIDv7. Every write is safe to retry: a repeat
  returns the original result.
- A logged set is written to IndexedDB before the screen updates. It is deleted only after the
  server acknowledges it, and never dropped silently (`docs/03` §8.1).
- Migrations follow the add-first rule (`docs/12` §3): they must work with the code already running.
  Drop, rename, `NOT NULL` and narrowing take two releases. Seed data ships as migrations.
- Never log or send to Sentry: food, weight or health values, photos, tokens, emails. Ids and error
  codes only.
- `/api/health` must not touch the database. Otherwise the uptime check keeps Neon awake.
- Errors are RFC 9457 problem details with our `code`.

## Workflow

- Before implementing any non-trivial change, grill me on requirements first —
  one question at a time, recommend an option, wait for my answer.
- Write tests before implementation where there's a natural seam.
- Review the diff against repo standards and the original request before saying it's done.
- For work spanning sessions, write a spec and tickets first.
- A feature with a UI surface clears the polish gate before it's done: `web-design-guidelines`,
  then `design:accessibility-review`, then `emil-design-eng`. It audits against `docs/05`; it doesn't
  reopen it.
