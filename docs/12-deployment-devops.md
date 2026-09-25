# 12 — Deployment / DevOps

_Written 2026-09-21. How the app ships. Where each piece runs and what it costs is `03` §3, what
happens when a service is down is `03` §4, and secrets and the security baseline are `03` §10. Those
are not restated here. Decisions are in `06` (2026-09-21, deployment)._

## 1. Environments

| | Local | Staging | Production |
| --- | --- | --- | --- |
| Git branch | any | `develop` | `main` |
| Web | `vite` dev server | Vercel preview, branch URL `overload-web-git-develop-yuta-asakuras-projects.vercel.app` | `https://overload-web-pied.vercel.app` |
| API | Hono on Node | Vercel preview of `overload-api`, branch `develop` | `https://overload-api-mu.vercel.app`, `sin1` |
| Database | Postgres 18 in Docker (`docker compose`, as in `11`) | Neon branch `staging` | Neon branch `main` (root) |
| Migrations | `pnpm db:migrate` (`drizzle-kit migrate`) by hand | In the API build (§3) | In the API build (§3) |
| Cron | none; call the route by hand | none (Vercel runs crons on production only) | `0 15 * * *` UTC (`03` §8.4) |
| Monitoring | none | Sentry events tagged `staging`, no alerts | Everything in §5 |

**Provisioned 2026-09-24.** Team `yuta-asakuras-projects`. Both projects created from the repo with
their root directories, `main` as the production branch, the API on the **`hono` framework preset**
(accepted by Vercel, so no `vercel.json` routes) in `sin1`, Node 24.x, and Deployment Protection
already **None** — set through the API and read back to confirm. The plain `overload-*.vercel.app`
names were taken, hence the suffixes above. The staging branch URLs are the standard
`<project>-git-develop-<team>` pattern and are confirmed against the dashboard after the first push
to `develop`.

- **Deployment Protection is off (None) on both projects** (binding). Vercel's Standard Protection —
  the recommended setting, on every plan — protects every domain except the production one (Vercel
  docs, checked 2026-09-23), which would put Vercel Authentication in front of both staging URLs.
  Three things break there, and none of them can send a bypass header: the `vercel.ts` rewrite
  proxies server-side with no Vercel cookie, so the staging web app gets an auth page instead of the
  API; Health Auto Export posts with an ingest token and nothing else; and the iPhone checklist
  (`11` §3) would have to clear a Vercel login inside the installed app before reaching Better Auth.
  What defends staging is its own: every route needs a session cookie, bearer or ingest token
  (`08`), the Neon `staging` branch holds test data only, and the bundle has nothing secret (§2).
  The cost, recorded: anyone with the branch URL reaches the sign-in screen, which is invite-only.
  *Decided 2026-09-23 (`06`).*
- **Staging is where the iPhone checklist in `11` §3 runs** — installed to the home screen from the
  `develop` branch URL, before `develop` is merged to `main`. Production holds real training data and
  is never the test bed.
- **PR previews** (any branch other than `develop` and `main`) use the Preview variables, so they
  point at the staging API and the Neon `staging` branch. They never run migrations (§3), so a
  preview whose PR adds a migration will fail against staging until that PR is merged to `develop`.
  Accepted: CI (`11` §5) is where a PR is proven, not its preview.
- **Neon `staging`** is a child branch of `main`. It holds test data only; it is never reset from
  `main`, so production data never reaches it.
- **One Google OAuth client for both** (Yuta's choice, to manage less). It lists two redirect URIs:
  the production web origin and the staging branch URL, each `…/api/auth/callback/google`. Local
  uses a third, `http://localhost:<port>/api/auth/callback/google`, on the same client.
- **One Anthropic key for both**, for now. Staging label reads are real calls and real spend. Split
  into two keys when staging spend needs to be told apart.

### The web → API rewrite per environment

`03` §5 routes `/api/*` through the web origin. `vercel.json` is static, so it would point staging
at the production API. The web project uses **`vercel.ts`** instead, which runs at build time and
reads env vars (Vercel docs, checked 2026-09-21):

```ts
// apps/web/vercel.ts
import { routes, type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  rewrites: [
    routes.rewrite('/api/(.*)', `${process.env.API_ORIGIN}/api/$1`),
    routes.rewrite('/(.*)', '/index.html'),
  ],
};
```

Verified 2026-09-24 (`06`): the feature is real, announced 2025-12-19; the package is `@vercel/config`
(0.7.2), imported from `@vercel/config/v1`; the export must be named `config`; and **only one config
file may exist — `vercel.ts` or `vercel.json`, never both.** `deploymentEnv('VAR')` defers a read to
deploy time if a build-time read turns out to be wrong. Still to confirm on the first deploy: that
`vercel.ts` is honoured alongside a framework preset, and its placement when the root directory is
`apps/web`.

**The API project needs no rewrite config at all.** Vercel has a first-class Hono preset: the app is
the default export of `apps/api/src/index.ts` and every path reaches it (`03` §5).

---

## 2. Environment variables

Set in each Vercel project. **Secret** type (write-only after saving) for every secret; **Config**
for the rest. Staging values are Preview variables scoped to the `develop` branch; unscoped Preview
variables carry the same values so PR previews match staging. Locally, a gitignored `.env.local`
per app, pointing at Docker Postgres — local never touches Neon.

| Name | Project | Type | Purpose | Staging vs production |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | api | Secret | Neon **pooled** connection, used at runtime, as role `overload_app` (`13` §5) | `staging` / `main` branch |
| `DATABASE_URL_DIRECT` | api | Secret | Neon **direct** connection, read only by `drizzle-kit migrate` in the build, as `overload_owner`. The pooler does not keep session state across a migration. Assume the function runtime holds it as well (`13` §10) | `staging` / `main` branch |
| `BETTER_AUTH_SECRET` | api | Secret | Session signing | **Different** |
| `BETTER_AUTH_URL` | api | Config | Public origin — the **web** origin, behind the rewrite (`03` §5) | Different |
| `GOOGLE_CLIENT_ID` | api | Config | Sign-in | Same |
| `GOOGLE_CLIENT_SECRET` | api | Secret | Sign-in | Same |
| `ADMIN_EMAIL` | api | Config | The one admin (`08`) | Same |
| `CRON_SECRET` | api | Secret | Vercel Cron's bearer (`08`) | **Different** (staging has no cron, but the route still checks it) |
| `ANTHROPIC_API_KEY` | api | Secret | Label reads (M2), estimates (M3) | Same, for now |
| `SENTRY_DSN` | api | Config | Errors, tagged with `environment` from `VERCEL_ENV` | Same |
| `VITE_SENTRY_DSN` | web | Config | Browser errors. Public by design: it ends up in the bundle | Same |
| `SENTRY_AUTH_TOKEN` | web, api | Secret | Source-map upload at build time | Same |
| `API_ORIGIN` | web | Config | Rewrite target in `vercel.ts`, read at build time | Different |
| `OFF_CONTACT` | api | Config | Contact in the Open Food Facts User-Agent (`03` §4) | Same |

- Anything prefixed `VITE_` is shipped to every browser. Only `VITE_SENTRY_DSN` has the prefix.
- Changing a variable does nothing until the next deploy, and an Instant Rollback keeps the old
  deployment's variables (Vercel docs, checked 2026-09-21). After rotating a secret, redeploy.
- One more secret lives outside Vercel: `DATABASE_URL_BACKUP` (direct connection, role
  `overload_backup`), a GitHub Actions secret for the nightly backup (`13` §2).
- Rotation steps for a leaked key are the incident plan in `13` §8.

---

## 3. Deploy

No deploy script. Vercel's Git integration builds both projects on every push.

- Push to `develop` → staging. Merge `develop` → `main` → production.
- Merges to either need CI green (`11` §5).
- The two projects deploy independently. Order does not matter as long as the API stays compatible
  with the web app already in people's service workers: the contract rule in `03` §1 and oasdiff in
  `11` already enforce this.

### Migrations run inside the API build

The API project's build is `apps/api/scripts/vercel-build.sh`, run as the package's `vercel-build`
script:

```sh
case "${VERCEL_GIT_COMMIT_REF:-}" in
  main | develop)
    : "${DATABASE_URL_DIRECT:?DATABASE_URL_DIRECT is not set}"
    drizzle-kit migrate
    ;;
esac
```

- **It lives in the repo, not in the dashboard.** The Hono preset's Build Command is *None*, and
  Vercel's Hono builder then runs the first of `vercel-build`, `now-build` or `build` from
  `package.json` before bundling `src/index.ts` itself (read from `@vercel/hono` and `@vercel/node`
  source, 2026-09-25). So nothing is set in the project settings, and a Build Command override there
  would replace this script. The command first written here ended in `pnpm build`, which fails: the
  API has no `build` script, and the preset needs none.
- **drizzle-kit** (0.31.10, with drizzle-orm 0.45.2 on the JavaScript `pg` 8.23.0 driver) reads
  `apps/api/drizzle.config.ts`, which takes `DATABASE_URL_DIRECT`. It applies every pending migration
  in `apps/api/migrations/` in **one transaction** and records each in `public.__drizzle_migrations`.
  The same command runs locally (`pnpm db:migrate`), in the Vitest and Playwright setups, and here.
  It replaced dbmate on 2026-09-25 (`06`): dbmate's Go `lib/pq` rejects the SCRAM iteration count
  `i=1` that Neon's gateway sends, so the first staging build could not connect.
- **`overload_owner` needs `CREATE` on the database.** drizzle-orm's migrator runs
  `CREATE SCHEMA IF NOT EXISTS` before every run, even for `public`, and Postgres checks the database
  privilege first. `infra/db/bootstrap.sql` grants it (`06`, 2026-09-25).
- **A failed migration prints no reason.** drizzle-kit 0.31.10 (and 0.31.11) wraps `migrate` in a
  progress spinner that calls `process.exit(1)` on a rejection without printing the error, so the
  build log shows only `applying migrations...` and exit 1. The failure still fails the build. To
  find the cause, run the same migrations against Docker (`pnpm db:migrate`), which reproduces
  anything that is not specific to the environment.
- **Node is pinned to 24** in `engines.node` and `packageManager` pins pnpm, in both apps and in CI.
  Vercel's default is already Node 24 and it honours `engines.node` over the dashboard setting; the
  pin is what stops laptop, CI and Vercel from diverging silently.

### Writing a migration

1. **A table or column change:** edit `apps/api/src/db/schema.ts` (or `auth-schema.ts`), run
   `pnpm --filter @overload/api db:generate`, and review the SQL it writes into `migrations/` with its
   snapshot and journal entry. Commit all three. Never `drizzle-kit push`.
2. **Anything Drizzle cannot express** (grants, functions, an expression index with `NULLS NOT
   DISTINCT`, seed rows): `pnpm --filter @overload/api exec drizzle-kit generate --custom
   --name=<what>` makes an empty migration with its journal entry; write the SQL into it, with
   `--> statement-breakpoint` between statements. drizzle-kit does not track what a custom migration
   creates, so changing it later is another custom migration.
3. **There are no down migrations.** Going backwards is §4.

**Better Auth's tables.** `pnpm dlx auth@<pinned version> generate --config scripts/auth-schema.ts
--output <scratch file>` (the CLI is the npm package **`auth`**, not the stale `@better-auth/cli`)
writes the whole Drizzle schema for the configured options, with no database. On every Better Auth
upgrade, generate into a scratch file, carry the difference into `src/db/auth-schema.ts` (keeping its
two edits: `timestamptz`, and snake_case index names), then step 1. If a field is missed, the
adapter's schema check fails the first auth call with "Drizzle schema mismatch", and the API tests
sign in, so CI catches it.
- **If a migration fails, the build fails** and the previous deployment keeps serving. A migration
  that succeeded before a later build step failed stays applied — which the add-first rule makes
  harmless.
- **Seed data is migrations too** (decided by default): the ~50 seeded exercises and the MEXT
  `reference_food` import are custom migrations whose SQL is generated (`pnpm --filter @overload/api
  seed:exercises` writes `0003_seed_exercises.sql`), so every environment gets them the same way. A
  correction is a new migration. `apps/api/seed/` holds the generator, not a runner.

### The add-first rule (binding)

Every migration must work with the code **already running**. Old code runs against the new schema
for the minutes between migration and promotion, and again after any rollback.

- **Allowed in one release:** add a table, add a nullable column or one with a default, add an
  index, widen a type, add a `CHECK` the existing data already meets.
- **Takes two releases:** drop or rename a column or table, make a column `NOT NULL`, narrow a type.
  Release 1 stops the code using it; release 2, after release 1 has been live, removes it.
- **Before a destructive migration reaches `main`:** take a manual Neon snapshot of `main`. Free
  keeps **one** snapshot, so it replaces the previous one.
- drizzle-kit has no down migrations. Going backwards is §4.

---

## 4. Rollback — written before the first deploy

### Bad code, schema fine (the usual case)

1. Vercel dashboard → the affected project → Production Deployment → **Instant Rollback**. On
   Hobby it goes back **one** deployment only.
2. Rolling back the API also rolls back its cron definition. The daily job is idempotent
   (`03` §8.4), so that is harmless.
3. **After a rollback, pushes to `main` no longer go live.** Fix forward on `develop`, merge to
   `main`, then **Undo Rollback** (promote the new deployment) to turn auto-assignment back on.
4. The web app's service worker may keep the bad shell until it updates. The contract rule means the
   rolled-back API still serves it.

### Bad data or a bad migration

Instant Rollback does not touch the database.

1. If the damage is under **6 hours** old (Free's restore window, or 1 GB of changes, whichever
   comes first): Neon console → branch `main` → Backup & Restore → **Restore from history**, to a
   time just before the damage. It overwrites the branch, drops connections briefly, and Neon keeps
   a backup of the pre-restore state automatically.
2. If older: restore the manual snapshot from §3, if one was taken for this change.
3. Otherwise, fix forward with a new migration.
4. Roll the code back to match the restored schema if needed (above), then fix forward.

Because of the 6-hour window, **check production within an hour of any deploy that migrates**.

The restore has never been tested. Running one on `staging` before M1 ships is on the checklist in §6.

---

## 5. Monitoring — finding out before a user does

All production-only, all $0. Sentry's Developer plan includes one uptime monitor and one cron
monitor, with email alerts (Sentry pricing docs, checked 2026-09-21).

| What breaks | How Yuta hears |
| --- | --- |
| An uncaught error, web or API | Sentry email on each **new** issue, filtered to `environment:production` |
| API down or unreachable | Sentry uptime check, `GET /api/health`, every **5 min**, 3 consecutive failures → email (about 15 min) |
| Daily job missed or failed | Sentry cron monitor: the job checks in at start and finish; a missed or failed check-in → email |
| A deploy fails (build or migration) | Vercel's deploy-failure email |
| Health Auto Export stops syncing | No alert. `health_sync_state` on the dashboard (S19) |
| Anthropic spend | Not alerted: the `overload` workspace's $10/month hard limit caps it (`13` §4) |
| Nightly backup fails | GitHub's failed-workflow email (`13` §2) |
| Neon CU-hours running out | No alert on Free. Once the first invitee joins, Yuta checks the month's CU-hours in the Neon console every Monday and moves to Launch before 80 of 100. Out of CU-hours, the compute is suspended until the next billing period (`03` §3) |

- **`/api/health` must not touch the database** (binding). A 5-minute check would keep Neon's compute
  from ever scaling to zero: always-on at 0.25 CU is about 180 CU-hours a month against Free's 100,
  and the database would stop partway through the month. The route answers `200` if the function
  runs. A database outage still surfaces as Sentry errors from real requests.
- The uptime check costs about 8,600 function invocations a month, well inside Hobby's 1M.
- Logging rules (what is never logged) are `03` §7.

---

## 6. Before the first production deploy

- [ ] Neon project, branch `staging` off `main`, **before** the roles exist (`13` §5).
- [ ] `infra/db/bootstrap.sql` run on `main` and on `staging`, with a different password per role
      per branch (`13` §5). Its `GRANT CREATE ON DATABASE` for `overload_owner`, added 2026-09-25,
      is applied on both before their first migration.
- [ ] Two Vercel projects, roots `apps/web` and `apps/api`, production branch `main`.
- [ ] Deployment Protection set to None on both projects (§1) — check the team default first.
- [ ] Every variable in §2, Secret type where marked, Preview values scoped to `develop`.
- [ ] Google OAuth client with all three redirect URIs.
- [ ] `vercel.ts` rewrite verified on the staging URL: sign-in round-trips, cookie set on the web origin.
- [ ] Sentry: two projects (web, api), new-issue alert on production, uptime monitor, cron monitor.
- [ ] A Neon restore from history, tried on `staging`.
- [ ] `drizzle-kit migrate` confirmed to run inside Vercel's build image, as `overload_owner`, on
      `staging` (§3). dbmate never did: its Go `lib/pq` refused Neon's SCRAM `i=1` (`06`,
      2026-09-25).
- [ ] `11` §3 checklist passed on staging.
- [ ] The security and backup items in `13` §9, "Before M1 ships".
