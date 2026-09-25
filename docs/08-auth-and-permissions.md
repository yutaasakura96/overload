# 08 — Auth and permissions

Who can sign in, how the API knows who is calling, and what each caller may do. Vocabulary is in
`CONTEXT.md`. Tables are in `docs/04`. Choices and the options rejected are in `docs/06`
(2026-09-15 auth approach, 2026-09-19 Better Auth verified, 2026-09-20 deletion rules, and the
2026-09-21 entry for this document).

Written 2026-09-21. Better Auth behaviour below was read from its docs and source through Context7
on that date.

---

## 1. Sign-in

- **Google only**, through Better Auth. There are no passwords, magic links or other providers.
- **Why:** every intended user already has a Google account, and a password system brings reset,
  breach and storage duties that a handful of invited users do not justify.
- **The invite gate** is `user.validateUserInfo`. Better Auth runs it when a Google identity is
  first provisioned, when an account is linked, **and on every later sign-in**, using the fresh
  email from Google. So a revoked email is refused the next time it signs in, not only at first use.
  - **Verified against Better Auth 1.7.5, 2026-09-24.** The option exists (added in 1.7.0) and works
    as described above. Signature:
    `(data: { user, source }, context) => Awaitable<void | { error, errorDescription? }>`; returning
    nothing admits, returning `{ error }` refuses — a redirect to the error URL in the browser flow,
    a 403 in programmatic ones. `source.action` is `create-user`, `link-account` or `sign-in`, and
    Google is identified by `source.oauth?.providerId === 'google'`, with the raw claims on
    `source.oauth?.profile`. Upstream carries a TODO to rename it to `validateUser`, so the version
    is pinned. `errorDescription` reaches the client — keep it free of anything sensitive.
- The callback lowercases the email and checks it against `invite.email`:

| Case | Result | Message on the sign-in page |
| --- | --- | --- |
| Invite row exists, `revoked_at IS NULL` | Allowed | — |
| Invite row exists, `revoked_at` set | Refused, `error: "access_revoked"` | "Your access was revoked." |
| No invite row | Refused, `error: "not_invited"` | "This Google account hasn't been invited." |
| Google reports the email unverified | Refused, `error: "email_unverified"` | "Use a Google account with a verified email." |

- **Native (later):** the iOS app signs in with Google's native SDK and posts the ID token to Better
  Auth's ID-token sign-in, with per-platform client IDs (verified 2026-09-17). The same
  `validateUserInfo` gate runs.

### Not in v1, deliberately

- **Password reset:** there are no passwords.
- **Email verification:** Google has already verified the address, and the gate refuses one it has
  not.
- **Public sign-up:** out of scope (brief). Removing the invite gate means dropping `invite` and the
  callback (`06`, 2026-09-20).
- **Two-factor:** Google's own 2FA covers the sign-in.

---

## 2. Sessions

| Setting | Value | Why |
| --- | --- | --- |
| Storage | Better Auth `session` rows in Postgres | Revoking deletes rows, so it takes effect on the very next request |
| `session.expiresIn` | **30 days** | Anyone who opens the app monthly never sees sign-in again. Sign-in needs signal, and the gym often has none |
| `session.updateAge` | 1 day (default) | A used session is pushed out to 30 days at most once a day, so reads do not write on every request |
| `session.cookieCache` | **Off** (the default; stated in config anyway) | With the cache on, a revoked session would keep working until the cached cookie's `maxAge` ran out |
| `session.freshAge` | 1 day (default) | Account deletion requires a session created within the last day (§6) |
| Cookie | Better Auth defaults: `HttpOnly`, `Secure`, `SameSite=Lax`, set on the web origin | The web app and API share one origin through the rewrite (`03` §5), so the cookie is first-party |
| Bearer | Better Auth bearer plugin | For the native client. The token *is* the session token, with the same expiry and the same revoke |

- **No JWTs.** Nothing needs stateless verification: the API and the database are in one region,
  and a session lookup is one indexed read.
- **No separate refresh token.** The sliding `updateAge` is the refresh.
- **CSRF**, by layer:
  - **`SameSite=Lax`** stops a cross-site POST from carrying the cookie, on every route. Every
    state-changing route is a non-GET method.
  - **`/api/auth/*`:** Better Auth also checks `Origin` against `trustedOrigins`, which holds the
    web origin only. This covers its own routes and nothing else.
  - **Every other cookie route:** Hono's built-in `csrf()` middleware, on all of `/api/*` except
    `/api/auth/*`, `/api/ingest/*` and `/api/cron/*`. It checks only unsafe methods with a
    form-sendable content type (`multipart/form-data` for `label-reads` and `meal-estimates`), and
    passes a request whose `Origin` or `Sec-Fetch-Site` passes, so JSON calls and the native app's
    bearer calls are unaffected (Hono docs, checked 2026-09-22). `origin` is set to
    `BETTER_AUTH_URL`, the web origin: behind the rewrite the API sees its own host, so the default
    would refuse the app itself. *Added 2026-09-22.*
- **Rate limiting** on `/api/auth/*`: Better Auth's limiter, `enabled: true` stated explicitly, with
  `storage: "database"`. Its default in-memory store is per instance, which on Vercel Functions
  means per cold start, so it limits nothing. Database storage needs Better Auth's `rateLimit` model,
  mapped to the `rate_limit` table (`04`).

---

## 3. Roles and callers

| Caller | How it is identified | What it is |
| --- | --- | --- |
| **Visitor** | No valid session | Anyone who has not signed in, including an uninvited or revoked person |
| **Member** | A valid session | Every signed-in user, Yuta included |
| **Admin** | A valid session **and** the user's email equals `ADMIN_EMAIL` | Yuta. A member with the invite list added. Not a separate account |
| **Ingest** | `Authorization: Bearer <ingest token>`, matched by SHA-256 against `ingest_token.token_hash`, not revoked | Health Auto Export on one user's phone, acting for that user on one route |
| **Cron** | `Authorization: Bearer <CRON_SECRET>`, compared in constant time | Vercel Cron. Vercel sends the project's `CRON_SECRET` env var this way (Vercel cron docs, checked 2026-09-21) |

- **Admin is an env var, not a role column.** There is one admin, and the only admin actions are
  over invites. Nothing in the database can promote a user, and a bad `UPDATE` cannot hand the
  role out. Changing the admin is a redeploy. The Better Auth admin plugin was rejected because it
  brings impersonation, which is a way into members' health data the PRD says the admin must not
  have.
- **The admin has an invite row of their own**, like everyone else, so the gate needs no special
  case *for authorisation*. The API refuses to revoke or delete the invite whose email equals
  `ADMIN_EMAIL`.
- **How that row first appears (bootstrap).** On a fresh database the gate would refuse everyone,
  including Yuta, and the only route that writes an invite needs a session (`06`, 2026-09-23). So it
  is written on first sign-in, across two hooks — **verified 2026-09-24** against Better Auth 1.7.5,
  whose docs are explicit that `validateUserInfo` is a policy gate and not a write seam:
  - `user.validateUserInfo` lets `ADMIN_EMAIL` through when no invite row exists.
  - `databaseHooks.user.create.after` upserts the `invite` row. It fires once, and receives the
    persisted user with its id.

  This refines the 2026-09-23 decision ("one branch in `validateUserInfo`") without changing it:
  every environment still bootstraps itself, and no migration or manual `INSERT` holds an email.
- **Ingest and cron never reach Better Auth's session lookup.** Their routes run their own
  middleware. An ingest token sent to any other route fails the session lookup and gets 401.

---

## 4. Permission matrix

✅ allowed · ❌ refused · **own** = only rows whose owner is the caller

| Action | Visitor | Member | Admin | Ingest | Cron |
| --- | --- | --- | --- | --- | --- |
| Open the sign-in page | ✅ | ✅ | ✅ | — | — |
| Sign in with Google | ✅ if invited and not revoked | — | — | — | — |
| Sign out, list or end own login sessions | ❌ | ✅ | ✅ | ❌ | ❌ |
| Read seeded exercises | ❌ | ✅ | ✅ | ❌ | ❌ |
| Create, edit, hide custom exercises and settings | ❌ | own | own | ❌ | ❌ |
| Routines, workouts, sets: read and write | ❌ | own | own | ❌ | ❌ |
| Food list, batches, rotation groups | ❌ | own | own | ❌ | ❌ |
| Profile, phase, day routine, meal slots | ❌ | own | own | ❌ | ❌ |
| Plan days: generate, read, confirm | ❌ | own | own | ❌ | ❌ |
| Barcode lookup, label read, meal estimate (third-party calls) | ❌ | ✅ | ✅ | ❌ | ❌ |
| Weigh-ins, health data, sync state: read | ❌ | own | own | ❌ | ❌ |
| Weigh-in by hand | ❌ | own | own | ❌ | ❌ |
| Correct an Apple workout link | ❌ | own | own | ❌ | ❌ |
| Ingest a Health Auto Export payload | ❌ | ❌ | ❌ | own | ❌ |
| Create, list, revoke ingest tokens | ❌ | own | own | ❌ | ❌ |
| Expenditure estimates, protocol suggestions: read, respond | ❌ | own | own | ❌ | ❌ |
| Export own data (S10) | ❌ | ✅ | ✅ | ❌ | ❌ |
| Delete own account (S10) | ❌ | ✅, fresh session | ✅, fresh session | ❌ | ❌ |
| List, add, revoke invites | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Read or change another user's data** | ❌ | ❌ | **❌** | ❌ | ❌ |
| Run the daily job | ❌ | ❌ | ❌ | ❌ | ✅ |

- **The admin sees no member data.** The invite list shows email, note, invited date and revoked
  date, and nothing about what a member has logged.
- **"own" is enforced in the data layer**, not per route: every function in `apps/api/src/db/` takes
  the caller's user id as its first argument and filters on it (`03` §10). Child rows (`set`,
  `plan_meal_item`) are reached by joining to a parent that carries `user_id`, never fetched by id
  alone.
- **Every id a request body refers to is resolved the same way.** `exerciseId`, `routineId`,
  `foodId`, `foodIds[]`, `batchId`, `appleWorkoutId`, `planMealId` and a synced row's parent id are
  each looked up through the caller's data layer before the write, and a seeded exercise also
  counts as the caller's. The foreign keys in `04` point at `id` alone, so the database would accept
  another user's id, and a join would then show that user's exercise name or Apple workout. An id
  that is not the caller's is refused exactly like one that does not exist: 422
  `validation_failed` on that field's path, `parent_missing` inside a sync batch. *Added
  2026-09-22.*
- **Someone else's row gives 404, not 403.** A 403 would confirm the id exists.
- **The daily job runs for every user**, and it is the only code path that is not scoped to one
  caller. It loops over users and calls the same per-user functions.

---

## 5. Where each caller lands

### Web app routes

| Route | Who | Unauthenticated visitor |
| --- | --- | --- |
| `/sign-in` | Everyone | Stays. Shows the gate's message from §1 when a sign-in was refused |
| Every other route | Member | Redirected to `/sign-in?next=<path>`, and back to `next` after sign-in. `next` must be a same-origin path |
| `/admin/invites` | Admin | A member gets the app's not-found screen, not a "forbidden" one |

### API routes

| Prefix | Auth | On failure |
| --- | --- | --- |
| `/api/auth/*` | Better Auth's own | Better Auth's responses |
| `/api/ingest/health-auto-export` | Ingest token | 401 problem detail. HAE records it in its Activity Logs |
| `/api/cron/*` | `CRON_SECRET` | 401 `unauthenticated` problem detail, with a generic `detail` |
| `/api/admin/*` | Admin | 404 to a member, 401 to a visitor |
| Everything else under `/api/` | Member | 401 |

The endpoint list is `docs/07`.

### Offline, and an expired or ended session

- **The web app is client-only**, so it cannot ask the server for the session while offline. It
  keeps the last confirmed signed-in user (id, name, email) in IndexedDB beside the cached API data.
- **Offline**, the app opens as that user, and the gym screen works exactly as it does online. New
  sets are pending and carry that user's id in the set store.
- **Back online**, a 401 from any request means the session has ended, whether it expired, was
  signed out elsewhere, or was revoked. The client cannot tell which from the 401, and it does not
  try:
  - Pending sets stay pending. **A 401 is not a refusal**; it does not mark sets refused.
  - The app shows a sign-in prompt over the current screen, not a redirect, so the gym screen is not
    lost mid-workout.
  - Signing in again as the same user resumes the upload.
  - If sign-in is refused with `access_revoked`, the pending sets are marked **refused, access
    revoked**, and the sign-in page says so. This is how the PRD's "revoked user with pending
    offline sets" edge case is told what happened.
  - Signing in as a *different* Google account on that device does not upload the first user's
    pending sets. The sign-out rule in §7 applies to them first.

---

## 6. Account deletion (S10)

- `user.deleteUser.enabled: true`. Deleting a Better Auth `user` row cascades through every table of
  ours (`04`).
- **Fresh session required.** Better Auth guards deletion with a session younger than `freshAge`
  (1 day). For a Google-only account that is the confirmation: if the session is older, the app
  asks the user to sign in with Google again, then offers deletion.
- **Confirmation:** the screen names what will go (workouts, sets, food list, plans, weigh-ins,
  health data), says what outlasts it (access records for a year, backups for up to 30 days), and
  offers an export first. The user types `DELETE` to confirm.
- **`beforeDelete`** removes the user's `invite` row. "Removes their access" in S10 means the email
  is no longer invited, and keeping the address after the account is gone would keep personal data
  that the user asked to remove. To come back, they need a new invite.
- **The admin cannot delete their own account** while the `ADMIN_EMAIL` env var names them. The API
  refuses by throwing a Better Auth `APIError` in `beforeDelete`, so the refusal arrives in Better
  Auth's `{ code, message }` format, not as a problem detail (`07` §1.3). This stops the only
  admin from locking themselves out by accident. Deleting it on purpose means changing the env var first.
- On the device, deletion runs the sign-out wipe in §7.

---

## 7. Sign-out

- **With nothing pending:** end the session, clear the TanStack Query cache and its IndexedDB copy,
  clear the stored signed-in user and the days left incomplete (`03` §6), and go to `/sign-in`.
- **With pending or refused sets:** first a dialog, "*N* sets not uploaded yet", with two actions:
  - **Upload now**, when online. Sign-out continues only when nothing pending is left. Refused sets
    still need the second choice.
  - **Discard and sign out**, which deletes them from the set store.

  Sets are never left on a device that nobody is signed in to, and they are only lost by an
  explicit choice. That is the same rule as "a set is never dropped silently" (`03` §7).
- **Why the cache is cleared:** weight, food and health numbers should not stay readable on a phone
  after its user signs out.
- Sign-out ends that login session only. "Sign out everywhere" is a separate action on the account
  screen: Better Auth's `POST /api/auth/revoke-sessions`, which ends every login session of the
  user, this one included (Better Auth docs v1.6.23, checked 2026-09-22). It then runs the same
  sign-out steps as above on this device.

---

## 8. Revoke (S9)

When the admin revokes an invite:
1. `invite.revoked_at` is set. The row stays.
2. Every `session` row for that user is deleted, so every device and a future native app is signed
   out on its next request.
3. Every `ingest_token` of theirs gets `revoked_at`, so Health Auto Export starts receiving 401.
4. **Their data stays.** Restoring the invite (clearing `revoked_at`) brings back sign-in and every
   row. **Ingest tokens stay revoked:** the member creates a new one on the health setup screen and
   pastes it into Health Auto Export. A token sat in an app that had lost access, and it was shown
   once, so un-revoking it would revive a secret nobody can see again. *Changed 2026-09-22* from
   "restores everything".

A revoked member cannot reach export or delete. If they ask for their data, the admin re-invites
them for the export. That is the revisit condition already written in `06` (2026-09-20). A separate
"export and delete only" mode was considered and rejected, because it would add a second auth state
to test on every route.

---

## 9. Ingest tokens

The table is `ingest_token`, and the setup is in `03` §9. Rules that concern auth:
- Made from 32 random bytes, shown once as base64url on the health setup screen, and stored as a
  SHA-256 hash. It can be copied, and it cannot be shown again. A lost token is revoked and a new
  one made.
- Looked up by hash on every ingest request, then checked `revoked_at IS NULL`. `last_used_at` is
  updated at most once an hour, so repeated exports do not each cost an extra write.
- Authorises `POST /api/ingest/health-auto-export` for its own user and nothing else.
- The token is never logged. Only the `ingest_token.id` is, per `03` §7.
- A user may hold several, one per phone, told apart by `label`.

---

## 10. Tests this document requires

Every one of these is a test, not a code-review item:
- **Cross-user, on every resource:** user B reading, updating and deleting user A's rows by id gets
  404, and A's rows are unchanged afterwards. Child rows are included (a set id, a plan meal item
  id).
- **Cross-user references, on every body field that holds an id:** user B creating or updating a
  row that points at A's id (an exercise, routine, food, batch, Apple workout, plan meal, or a
  synced row's parent) is refused as in §4, and no row of B's refers to A's afterwards.
- The gate refuses a non-invited email, a revoked email and an unverified email, each with its own
  error.
- After revoke, the revoked user's cookie session, bearer session and ingest token each get 401 on
  their next request.
- A member calling `/api/admin/*` gets 404.
- An ingest token sent to a member route gets 401. A session cookie sent to the ingest route gets
  401.
- `/api/cron/*` without the secret, or with a wrong one, gets 401.
- A cross-origin `multipart/form-data` POST to `/api/label-reads` with a valid cookie gets 403, and
  the same request from the web origin passes.
- Account deletion with a session older than `freshAge` is refused, and after deletion no row with
  that `user_id` remains in any table except `audit_event`, whose rows are kept for a year (S10).
- Offline: an expired session with pending sets keeps them pending, and they upload after
  re-sign-in.

---

## Unverified, to check when built

- The error shape `validateUserInfo` returns on the redirect flow, **read from 1.7.5's callback
  source 2026-09-25**: a refusal becomes a redirect to the sign-in call's `errorCallbackURL` with
  `?error=<our code>&error_description=<our text>`. The sign-in page maps `error` to its own wording
  and ignores the description. Slice 1 tests the page with the query string and the gate's `403` on
  the programmatic path; the Google round trip itself is only observed on staging (`11` §3 item 2).
- ~~Whether Better Auth's rate limiter is enabled by default in production.~~ **Answered 2026-09-25**
  from 1.7.5's source: `enabled` defaults to "is production", so it is on in production and off in
  development and test. We set `enabled: true` regardless. **Storage is `database`** — the default is
  in-memory, which a Vercel function does not keep between invocations (`06`, 2026-09-24).
- The limiter keys each bucket by client IP, read from `x-forwarded-for` only, and **only when the
  header holds exactly one address**. Anything else falls into one shared bucket per path and logs a
  warning once. What the API sees behind the rewrite is `13` §10's open question.
- Better Auth's default cookie attributes, **read from 1.7.5's source 2026-09-24**: `httpOnly`,
  `sameSite: 'lax'`, `path: '/'`, `secure` derived from the `baseURL` protocol, and a `__Secure-`
  name prefix when secure. Still worth confirming in the browser once deployed. The `session_token`
  value is the session token HMAC-signed with `BETTER_AUTH_SECRET`, in the form `token.signature` —
  so a session row inserted by hand will not authenticate.
- ~~Whether `database: { casing: 'snake' }` renames Better Auth's tables as well as its columns.~~
  **Answered building slice 1** (`06`, 2026-09-24): it renames nothing, because nothing in 1.7.5 reads
  it. snake_case comes from the Drizzle columns in `apps/api/src/db/auth-schema.ts` (`04`, `06`
  2026-09-25), and a Vitest sign-in fails if any column name is wrong.
- Whether `list-sessions` sits behind Better Auth's fresh-session middleware on the pinned version,
  as it does in current source. If so, the account screen's session list needs a sign-in less than a
  day old, like deletion (§6).
