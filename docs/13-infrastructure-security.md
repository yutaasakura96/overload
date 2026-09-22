# 13 — Infrastructure and security

_Written 2026-09-21. What the app runs on and how it is defended. Where each piece runs and what it
costs is `03` §3, what happens when a service is down is `03` §4, the security baseline is `03` §10,
and how it ships is `12`. Those are not restated here. Decisions are in `06` (2026-09-21,
infrastructure and security)._

## 1. Deployable units

`03` §3 lists the web app, API, daily job, database and Health Auto Export. This doc adds one:

| Unit | Runs on | State | If it dies |
| --- | --- | --- | --- |
| Nightly backup | GitHub Actions scheduled workflow → S3, `ap-northeast-1` | Stateless job; the dumps are the state | The next night's run covers it. A missed run is visible as a failed workflow (GitHub emails the repo owner) |

### Infrastructure as code

- **Vercel and Neon: none.** Both are configured in their dashboards by the checklist in `12` §6.
  Two projects and one database are not worth a provider's Terraform surface today.
- **AWS: Terraform, in `infra/aws/`.** The backup bucket, its lifecycle rule, the GitHub OIDC
  provider and the backup role. Applied by hand from Yuta's machine (`terraform apply`), state in a
  separate S3 bucket with versioning on. The future platform is AWS, so this is where the IaC starts
  and it grows at the move.

---

## 2. Backups

Neon Free alone gives a 6-hour / 1 GB restore window and one manual snapshot, with no scheduled
backups (Neon plans page, checked 2026-09-21). Bad data noticed the next morning would be
unrecoverable. So:

| | |
| --- | --- |
| **What** | `pg_dump --format=custom` of the Neon `main` branch (production only; staging holds test data) |
| **When** | Nightly, GitHub Actions `schedule`, `0 18 * * *` UTC (03:00 JST) — after the daily job at `0 15 * * *` UTC has finished |
| **Connection** | `DATABASE_URL_BACKUP`: the **direct** (non-`-pooler`) host, as Neon's pg_dump guide requires, as role `overload_backup` (§5). A GitHub Actions secret, not a Vercel variable |
| **Encryption** | The dump is encrypted with `age` to a public key committed in the repo **before** upload. The private key lives offline with Yuta, never in GitHub or AWS. The bucket also has SSE-S3 |
| **Where** | S3 bucket in Yuta's AWS account, `ap-northeast-1`. Block Public Access on, versioning on |
| **AWS auth** | GitHub OIDC → IAM role. No long-lived AWS keys anywhere. The role's policy is `s3:PutObject` on `backups/*` of that one bucket — it cannot read, list or delete |
| **Retention** | Lifecycle rule: current objects expire after 30 days, non-current versions after 7 |
| **Cost** | A dump is a few MB at current scale — cents a month |

Pattern documented by Neon ("Automate pg_dump backups", GitHub Actions → S3), checked 2026-09-21.

### Restore — both paths tested before M1 ships

| Path | Use when | Test |
| --- | --- | --- |
| Neon restore from history | Damage under 6 hours old (`12` §4) | Once on `staging`, before M1 |
| S3 dump | Anything older, or Neon itself is the problem | Download, `age -d`, `pg_restore` into Docker Postgres, run the API's test suite against it. Before M1, then quarterly |

A restore that has never run is not a backup. Both tests are on the checklist in §9.

---

## 3. Network boundary

| Reachable from the internet | Protected by |
| --- | --- |
| Web origin (`overload-web` on `vercel.app`) | Static files; nothing secret in the bundle (`12` §2) |
| API (`overload-api` on `vercel.app`), via the rewrite and directly by Health Auto Export | Session cookie or bearer token on every route except `/api/health`; ingest token on the ingest route; `CRON_SECRET` on the cron route (`08`) |
| Neon endpoint | Role password + TLS. **No IP allowlist:** Neon's IP Allow is Scale-plan only, and Vercel Functions have no fixed outbound IPs anyway |

| Private | |
| --- | --- |
| S3 backup bucket | Block Public Access; only the backup role can write, only Yuta's IAM user can read |

### DNS

Only the Vercel-assigned `vercel.app` names. No custom domain (`06`, 2026-09-21).

**Cost of that, recorded now:** at the move to AWS, the web and API URLs change. Then:
- every user re-enters the ingest URL in all three Health Auto Export automations (`03` §9)
- the Google OAuth redirect URIs are replaced
- every session ends, and everyone signs in again

This is step one of the migration notes, whenever they are written.

### Caching

| Path | `Cache-Control` | Invalidation |
| --- | --- | --- |
| Hashed assets (`/assets/*`) | `public, max-age=31536000, immutable` | New filename per build |
| `index.html`, service worker, manifest | `no-cache` | Revalidated every load; the service worker picks up the new shell |
| `/api/*` | `no-store` | Nothing API-side is ever cached at the edge. Client caching is TanStack Query's (`03` §6) |

### Rate limiting

| Where | Limit | When hit |
| --- | --- | --- |
| Vercel WAF, web project, `/api/*` | 300 requests / 60 s per IP, fixed window (Hobby allows one rate-limit rule per project; checked 2026-09-21) | Vercel returns `429` before the function runs |
| Anthropic workspace | $10/month hard limit (§4) | Anthropic returns `400 invalid_request_error`; the manual form opens (`03` §4) |
| Label reads, per user per day | **Not in v1.** Added before the first invitee (§9) | `429` problem response; the manual form opens |
| Open Food Facts | Their 15 reads/min per IP (`03` §4) | Inline message |

- 300/min is well above one person's use: a sync batch is one request, and the heaviest screen fires
  a handful. It exists to stop a runaway loop in the client, not a determined attacker.
- **Unverified:** what client IP the API project sees on a request rewritten from the web project.
  Until checked, the rule sits on the web project only. Health Auto Export calls the API directly
  and is not covered — its ingest token is the control.

---

## 4. Keys and their scopes

| Secret | Where it lives | Scope | Cannot |
| --- | --- | --- | --- |
| `DATABASE_URL` | Vercel, api | Role `overload_app` (§5) | Change the schema |
| `DATABASE_URL_DIRECT` | Vercel, api (build only) | Role `overload_owner` | — (it is the owner; only dbmate uses it) |
| `DATABASE_URL_BACKUP` | GitHub Actions secret | Role `overload_backup` | Write anything |
| `BETTER_AUTH_SECRET` | Vercel, api | Signs sessions | — |
| `GOOGLE_CLIENT_SECRET` | Vercel, api | The one OAuth client (`12` §1) | — |
| `ANTHROPIC_API_KEY` | Vercel, api | A dedicated **`overload` workspace**, $10/month limit. A key belongs to one workspace and cannot be moved (Anthropic docs, checked 2026-09-21) | Spend past the workspace limit, or touch other workspaces |
| `CRON_SECRET` | Vercel, api | The cron route only (`08`) | — |
| `SENTRY_AUTH_TOKEN` | Vercel, web and api | Source-map upload: `project:releases` scope only | Read events or change alerts |
| GitHub → AWS | None stored: OIDC | `s3:PutObject` on `backups/*` | Read, list, delete |
| Ingest tokens | Hashed in `ingest_token` | One route, one user (`08` §9) | Anything else |
| `age` private key | Offline, with Yuta | Decrypts backups | — |

---

## 5. Database roles

Neon allows limited roles on Free, created by SQL (roles made in the console get
`neon_superuser`; checked 2026-09-21). Three roles, created by the first migration, identically in
local Docker, CI and both Neon branches — so a missing grant fails a test, not production.

| Role | Used by | Privileges |
| --- | --- | --- |
| `overload_owner` | dbmate, via `DATABASE_URL_DIRECT` | Owns the schema and every table. DDL |
| `overload_app` | The running API, via `DATABASE_URL` | `SELECT, INSERT, UPDATE, DELETE` on app tables. `SELECT, INSERT` only on `audit_event`. `EXECUTE` on `purge_audit_events()`. No DDL |
| `overload_backup` | GitHub Actions `pg_dump` | `SELECT` on every table, and `USAGE` on the schema |

- `ALTER DEFAULT PRIVILEGES FOR ROLE overload_owner` in the first migration grants the app and
  backup privileges on every future table. A table that needs different grants (as `audit_event`
  does) revokes after creating.
- Better Auth's tables are app tables: its adapter needs full DML on them, nothing more.

---

## 6. Threat model

Who would attack an invite-only lifting tracker, most likely first:

| # | Threat | Want | Control |
| --- | --- | --- | --- |
| 1 | A signed-in user, or a bug | Another user's data | Session user applied in the data layer on every query; cross-user tests on every resource (`03` §10, `11`) |
| 2 | Anyone holding a leaked key or session | The Anthropic bill | $10 workspace limit now; per-user model-call cap before invitees |
| 3 | Anyone holding a leaked ingest token | Write junk health data for one user | One route, one user, revocable; payloads schema-checked (`08` §9) |
| 4 | Anyone holding a leaked DB URL | All the data | Runtime URL can't drop tables (§5); rotation in §8 |
| 5 | Anyone with the backup workflow | The dumps | Write-only role; dumps encrypted to a key that is not online |
| 6 | Opportunistic scanners | Anything open | Nothing public without auth except `/api/health` and static files; WAF rule |

Not in scope: a targeted attacker with resources. Nothing here is worth it to one, and nothing
here would stop one.

---

## 7. Audit trail

Table `audit_event` (`04`), written **in the same transaction** as the action it records, so an
action and its record exist together or not at all.

| Action | Actor | Target |
| --- | --- | --- |
| `sign_in` | the user | — |
| `sign_out` | the user | — (`detail`: count of discarded pending sets, `08` §7) |
| `invite_created` | admin | `invite` |
| `access_revoked` | admin | `user` |
| `access_restored` | admin | `user` |
| `ingest_token_created` | the user | `ingest_token` |
| `ingest_token_revoked` | the user or admin | `ingest_token` |
| `account_deleted` | the user | `user` — the row outlives the account; `actor_user_id` has no FK |
| `admin_action` | admin | whatever it touched |

- Never in it: health values, food, weights, tokens, emails. Ids, IPs and user agents only.
- The app role can insert and read, not update or delete. Rows older than one year are removed by
  the daily job through `purge_audit_events()`, a `SECURITY DEFINER` function owned by
  `overload_owner` that deletes only rows past that age.
- Read by SQL in the Neon console. No admin screen in v1.

---

## 8. Incident plan — written before the fire

### A secret leaks

The first three steps, for every secret. Rotating a Vercel variable does nothing until a redeploy,
and an Instant Rollback brings the old value back (`12` §2), so **redeploy, then don't roll back
past it.**

| Secret | 1. Stop it | 2. Replace it | 3. Check |
| --- | --- | --- | --- |
| `DATABASE_URL` / `_DIRECT` / `_BACKUP` | Neon console → reset that role's password | New URL into Vercel (or GitHub); redeploy the API | Neon's active connections; `audit_event` and recent row changes for anything unexpected |
| `BETTER_AUTH_SECRET` | New value in Vercel; redeploy. Every session ends — intended | — | `audit_event` `sign_in` rows since the leak |
| `GOOGLE_CLIENT_SECRET` | Google Cloud console → add a new secret, then disable the old | New secret into Vercel; redeploy | Sign-in round-trips on staging, then production |
| `ANTHROPIC_API_KEY` | Anthropic console → disable the key | New key in the same `overload` workspace; into Vercel; redeploy | Workspace usage page for spend since the leak |
| `CRON_SECRET` | New value in Vercel; redeploy | — | The job is idempotent, so extra runs did no harm; check the cron monitor |
| `SENTRY_AUTH_TOKEN` | Sentry → revoke the token | New token into Vercel | Nothing to check; it can only upload source maps |
| An ingest token | Revoke it in the app (or `UPDATE ingest_token SET revoked_at = now()`) | User makes a new one and updates Health Auto Export | That user's `health_sample` rows since `last_used_at` looked wrong |
| AWS (OIDC role) | Remove the trust policy's GitHub condition | Re-add after the cause is found | S3 object list and CloudTrail for the bucket |
| `age` private key | Generate a new key pair; commit the new public key | Old dumps expire in 30 days; delete them sooner if the key is known exposed | Who could have read S3 (should be only Yuta) |

### Data is read or changed by someone who shouldn't have

1. **Contain:** revoke the actor (`08` §8) and rotate whatever they held, by the table above.
2. **Preserve:** take a Neon snapshot of `main` before touching anything, and save the relevant
   `audit_event` rows and Sentry events.
3. **Assess and tell:** work out whose data and which tables from `audit_event` and the snapshot,
   then tell each affected user directly. Legal notification duties are part of the compliance work
   in §9.

---

## 9. Before the first invitee

Nothing below is needed while Yuta is the only user. All of it is needed before a friend signs in.

- [ ] **Per-user daily model-call cap** in the API (proposed: 20/day), counting label reads and
      meal estimates together, with a `429 model_cap_reached` problem response that opens the manual
      form. A label read leaves no row (`04`), so the count needs its own store; decide it with the
      cap. *Widened 2026-09-22* from label reads only (`09` F15).
- [ ] **Compliance.** Invitees would be mostly in Japan and the Philippines. Deferred by Yuta
      2026-09-21 as too early; what verification already found, so the work starts from here:
  - APPI covers non-profit activity; whether a private app for friends is 事業 is a grey zone the
    PPC guidelines do not settle.
  - Bodyweight and heart rate outside medical care are generally not 要配慮個人情報. Sleep and HRV
    are not named (inference: same).
  - Neon in Singapore falls under the cloud exception only if Neon's contract says it does not
    handle the stored data — **read Neon's DPA**.
  - Label and meal photos sent to Anthropic (US) are a transfer to a foreign third party; consent
    after informing the user is the simplest basis.
  - The Philippines' Data Privacy Act 2012 has not been checked.
  - Sources: PPC guidelines 通則編 2-3, 2-5; 外国第三者提供編; APPI Q&A 7-53, 10-25, 12-1, 12-3.
- [ ] **Split the Anthropic key** by environment if staging spend is visible (`12` §1).

### Before M1 ships (production, even for Yuta alone)

- [ ] Terraform in `infra/aws/` applied: bucket, lifecycle, OIDC provider, backup role.
- [ ] `age` key pair made; public key committed; private key stored offline.
- [ ] Anthropic `overload` workspace with a $10/month limit; its key in Vercel.
- [ ] Three database roles on both Neon branches; `DATABASE_URL` switched to `overload_app`.
- [ ] Backup workflow run once by hand; object visible in S3.
- [ ] S3 restore tested into Docker (§2). Neon restore tested on `staging` (`12` §6).
- [ ] WAF rule on the web project.

---

## 10. Unverified, to check when built

- What client IP the API project sees on a request rewritten from the web project (§3).
- Neon's DPA terms, for APPI's cloud exception (§9).
- Whether Better Auth's adapter works under `overload_app` with no DDL (it should; its tables are
  created by our migrations, not by Better Auth at runtime).
- Sentry auth token scope names at the time of creation.
