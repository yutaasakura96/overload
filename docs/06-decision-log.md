# 06 — Decision Log

Append-only.

### [2026-09-15] Audience: personal-first, invite-only
- **Decision:** Built for Yuta first. Other people get access only by admin invite, and each has the full app for their own data.
- **Alternatives considered:** Yuta only, with no auth; a public product.
- **Reason:** Keeps sharing with friends possible without the cost of a public product (onboarding, public sign-up, support).
- **Revisit if:** Opening to people outside the invite list becomes a goal.

### [2026-09-15] Auth approach: Better Auth with Google, invite allowlist
- **Decision:** Google is the only identity provider, through Better Auth. Sign-in is refused for any email not on the admin's invite list.
- **Alternatives considered:** No auth (single user); auth as a data-model placeholder only.
- **Reason:** The app will be on the public internet and hold health data, so real auth is needed even with a single user.
- **Revisit if:** Better Auth's invite/allowlist support does not hold up when verified in Phase 4 (not yet checked against docs).

### [2026-09-15] Scope: replace a lifting app and a diet coach, in three milestones
- **Decision:** Build the lift logger (M1), then health and weight ingestion with overlays (M2), then diet coaching (M3). Nothing is integrated from Hevy or MacroFactor.
- **Alternatives considered:** Replace lifting only and keep MacroFactor; integrate existing apps and replace nothing.
- **Reason:** Yuta uses no tracking app today, so there is nothing to integrate with, and the combined view needs data the app owns. M2 comes before M3 because adaptive expenditure needs weight-trend history.
- **Revisit if:** M1 stalls long enough that M3 looks unreachable. Then consider using MacroFactor in the meantime.

### [2026-09-15] Biggest scope cut: no native iOS or watchOS app
- **Decision:** Sets are logged in a mobile web app on the phone. Apple Health data comes in through Health Auto Export's REST automation.
- **Alternatives considered:** A watchOS app for logging mid-set; a native iOS HealthKit companion app.
- **Reason:** Apple Health has no web API, and a native app means Swift, Xcode and App Store distribution. Phone logging between sets is enough.
- **Revisit if:** Health Auto Export turns out unreliable or too expensive (tier/pricing for REST automations unverified), or invitees cannot be expected to buy it.

### [2026-09-15] Set logging is offline-first
- **Decision:** Sets save on the device first and sync later, with client-generated ids to prevent duplicates.
- **Alternatives considered:** Online-only with an error on a failed save.
- **Reason:** Gyms often have poor signal, and a lost set undermines the riskiest assumption (that the logger is reliable enough to use).
- **Revisit if:** Never, for set logging.

### [2026-09-15] Progress metric and progression rule
- **Decision:** e1RM (Epley, best working set per session) is the primary progress line, with top-set weight and volume load as secondary stats. Suggestions use double progression: add the increment once every working set reaches the top of the rep range.
- **Alternatives considered:** Top-set weight or volume load as the primary line; showing last time only; full programme support.
- **Reason:** e1RM stays comparable across rep ranges, and double progression is simple, transparent and always overridable.
- **Revisit if:** e1RM proves misleading at high reps (Epley is least accurate above roughly 10 reps).

### [2026-09-15] Bodyweight source: Eufy scale via Apple Health
- **Decision:** No reverse-engineering of the scale. EufyLife writes weight, body fat %, BMI and lean body mass to Apple Health, and the data arrives here along with the other health metrics.
- **Alternatives considered:** Hacking the Eufy scale's Bluetooth protocol directly.
- **Reason:** A supported path already exists (eufy support, 9to5Mac, checked 2026-09-15). Caveat: on Bluetooth models the EufyLife app must be open during the weigh-in.
- **Revisit if:** The EufyLife → Health sync proves unreliable.

### [2026-09-15] Photo and text meal estimates ship in M3
- **Decision:** Both photo and text estimation are M3 MUSTs, always confirmed by the user and labelled as estimates. Recurring meal templates carry most of the logging.
- **Alternatives considered:** Text first with photo later; templates and search only.
- **Reason:** Yuta eats mostly the same food, so templates handle most days, and adaptive expenditure absorbs estimate error. Macro error from photos is high (48–66% measured), so estimates are never silent.
- **Revisit if:** Vision API cost or accuracy is unacceptable once measured in Phase 4.

### [2026-09-16] Meal planning added; milestones reordered
- **Decision:** Meal planning from a personal food list and weekday routine becomes a core feature: meal split, carbohydrate timing around training, prep plan, grocery list. Milestones are now M1 Training log → M2 Meal plan + weight → M3 Health + coaching (watch data, overlays, adaptive expenditure, photo/text estimates, plateau protocols). This supersedes the ordering in "Scope: replace a lifting app and a diet coach".
- **Alternatives considered:** Diet planning as M1; keeping all diet work in M3.
- **Reason:** Meal planning is Yuta's most pressing day-to-day problem. The training log stays first because it tests the riskiest assumption. M2 now collects the confirmed intake and weight trend that adaptive expenditure in M3 needs.
- **Revisit if:** M1 takes long enough that the diet problem can't wait.

### [2026-09-16] Meal count comes from protein distribution, not "starvation mode"
- **Decision:** The app recommends a meal count to spread protein at 0.4–0.55 g/kg per meal across at least 4 meals, and tells the user that meal count doesn't change fat loss at equal calories. A flat weight trend is investigated by measuring intake against the trend first.
- **Alternatives considered:** More meals to "fix starvation mode"; the user picks a count with no recommendation.
- **Reason:** Adaptive thermogenesis is real but small, about 65–230 kcal/day after moderate loss (PubMed 34839398). People reporting under 1,200 kcal/day with no weight loss were eating 47% more than they reported, with metabolic rates within 5% of predicted (Lichtman 1992, NEJM). A meal-frequency meta-analysis found no reliable benefit for body composition (Schoenfeld 2015). Protein distribution: Schoenfeld & Aragon 2018. All checked 2026-09-16.
- **Revisit if:** Measured expenditure from complete logged weeks comes out well below predicted.

### [2026-09-16] The plan is the log
- **Decision:** Planned meals are confirmed rather than typed: eaten as planned, adjust, or replaced. An end-of-day check sweeps up unconfirmed meals. An unconfirmed meal never counts as eaten, and incomplete days are left out of expenditure estimates.
- **Alternatives considered:** Auto-logging planned meals unless they are edited; an end-of-day check only.
- **Reason:** Typing everything in is the reason Yuta doesn't log today. Auto-logging would silently corrupt the expenditure estimate when a change is forgotten, so confirmation keeps the data honest at one tap per meal.
- **Revisit if:** Confirmation compliance drops below about 6 days in 7.

### [2026-09-16] Cooked portions from recorded batch yields; food data from database plus manual entry
- **Decision:** Batch-cooked foods are portioned by cooked weight and converted using that batch's recorded raw → cooked yield. Foods are added once by database search or barcode, with manual label entry as a fallback.
- **Alternatives considered:** Raw-weight portions; manual label entry only; database only.
- **Reason:** Yuta weighs cooked portions from Instant Pot batches, and yield varies by batch, so a generic cooked value would be inaccurate. Manual entry covers foods the database doesn't have.
- **Revisit if:** Recording yields proves too much friction. Then fall back to database cooked values.

### [2026-09-16] PRD review: plan tolerances and an early maintenance check
- **Decision:** A generated plan lands within ±5% of the calorie target and ±5 g of protein, with portions rounded to 5 g and eggs kept whole. M2 gains a read-only maintenance check (S18a) after 14 complete days. Photo/text estimates stay in M3, so M2 off-plan meals are logged from the food list or by hand.
- **Alternatives considered:** ±2% / ±2 g (odd portions) or ±10% / ±10 g (swallows a deficit); 1 g or 10 g rounding; all measured expenditure in M3, or full adaptive expenditure in M2; text or photo estimates moved into M2.
- **Reason:** The core complaint is "eating clean but not losing", so measured maintenance is needed as soon as confirmed intake exists. Keeping it read-only avoids building the adaptive model twice.
- **Revisit if:** Plans regularly can't meet the tolerance with a realistic food list, or off-plan meals are frequent enough in M2 that manual entry stops logging.

### Pending (Phase 4)
Database and hosting choices (stack decided 2026-09-19, below), the food database source and its licensing (it now also needs barcode lookup), the photo/text estimation provider, and which Health Auto Export tier is needed and what it costs.

## 2026-09-16 — Visual direction: Instrument

**Decision.** Instrument — dense mono-figure grid on a cool near-black ground, JetBrains Mono for
figures, IBM Plex Sans for labels, single cyan accent (#3FB6D4) with a muted green (#57C99A) for
completed state. The live session screen borrows Heavy's scale for the active set row only: the
working weight is set at 56px and the completion control is full-width.

**Why.** Four of the six v1 screens are irreducibly dense — the e1RM chart with four independently
toggleable overlays (S20), the weekly prep plan and grocery list (S17), the meal plan with per-food
grams against five macro targets (S16), and the maintenance check (S18a). Instrument is the only one
of the three directions whose grammar carries into all four unchanged.

**Rejected — Heavy** (brutalist, one exercise fills the screen, 96px numerals). It wins the mid-set
moment outright and nothing else comes close there, but it has no answer for the four dense screens:
adopting it means building a second, denser vocabulary for two thirds of the app, and extracting two
design systems in Phase 3. The narrow win it does have is recoverable inside Instrument by scaling
the active row, which is what was done.

**Rejected — Quiet** (warm editorial dark, Newsreader headings, amber accent). Best-looking of the
three and it does not win a single screen: worse than Instrument at arm's length in a gym, and no
better on the nutrition screens, which are tables of numbers underneath the serif.

**Known risk.** If the real failure mode turns out to be not logging at all because the app reads as
a spreadsheet, Quiet was the better bet — adherence beats density. Revisit after M1 is in daily use.

**Carried into the build, unresolved.** The carb-shift recommendation (S16, last bullet) needs an
evidence tag and none of the three directions drew one; settle the evidence-tag treatment when
building screen 3, since S23 needs the same component.

## 2026-09-16 — Phase 3 extraction: six text tones, and the contrast cost left on the record

**Decision.** `docs/05-design-system.md` documents six text tones, not the four the canvas sticky
note claimed, and records the measured WCAG contrast of every one rather than adjusting any of them.
The failing tones — `#5A6673` (3.32:1), `#4A5560` (2.56:1), `#3C464F` (2.02:1), `#8A7340` (4.27:1),
and the `#2A3440` control boundary (1.54:1) — are kept exactly as drawn.

**Alternatives considered.** Raising the failing tones during extraction to reach AA; collapsing the
six tones back to the note's four by reassigning uses.

**Reason.** Instrument's rank ladder is built out of those steps, and raising them is a visual change
that softens the direction toward Quiet — which the direction decision above explicitly says must be
raised rather than done quietly. Phase 3 extracts; it does not redesign. The six tones are used
consistently enough for rank that collapsing them would lose information the artboards carry.

**Revisit if:** Yuta decides on one of the three options in `docs/05` §7.6 — accept and record;
raise only the tones carrying content that must be read; or add a high-contrast mode.

## 2026-09-16 — The 56px active set is specified as a named exception with constraints

**Decision.** The 56px figure on screen 1 is documented as a single named exception to the 17–18px
figure scale, with four constraints: one row at a time, dropping to 17px the moment the set is
completed, no other screen may use it, and its unfilled state stays 56px in `#4A5560`. A second
proposed use is a change to the type scale and belongs in this log.

**Alternatives considered.** Documenting it as a second display scale alongside the body scale.

**Reason.** It is a borrow from the rejected Heavy direction covering one moment — mid-set, arm's
length. Written as a scale it would spread; written as a constrained exception it cannot.

**Revisit if:** A second screen has a genuine arm's-length reading moment.

## 2026-09-16 — Phase 3 found gaps the PRD requires and no artboard covers

**Decision.** `docs/10` §8 lists them rather than inventing screens for them: session start and
routine selection, exercise library, food list management, goal and target setup, the grocery list
proper, invite administration, export and delete, health setup and dashboard, photo/text estimation,
plateau protocols beyond the evidence tag, and every error and failure state. The palette has no
error colour at all.

**Alternatives considered.** Designing them during extraction; leaving them undocumented until the
build hit them.

**Reason.** Six screens were scoped in Phase 2 deliberately. Drawing more during an extraction phase
would produce untested design with no direction review behind it. Listing them makes the shortfall a
known input to Phase 4 rather than a mid-build surprise.

**Revisit if:** Never — these get designed when their milestone comes up.

## 2026-09-19 — Two apps, one backend; web app first

**Decision.** The product becomes two clients over one backend. A **native iOS app** (Swift/SwiftUI)
carries the daily loop: set logging, rest timer, meal confirmation, morning weight and health data
via HealthKit, grocery list, photo estimates. A **web app** carries setup and analysis: routines and
exercise library, food list, phase and targets, progress charts and overlays, maintenance check,
expenditure, plateaus, invites, export/delete. The **web app is built first**, phone-first and
covering everything through M2; the native app is planned for later, probably arriving with M3.
This moves "Native iOS app" in the brief from Out of scope to LATER. Android (Kotlin) is not planned.

**Alternatives considered.** Web only (the brief's position); native iOS first, which would test M1
in the real phone app and make HealthKit available for M2's weight; React Native, Flutter and Expo,
all rejected by Yuta.

**Reason.** Daily use is in hand and needs what the phone does well (HealthKit, camera,
arm's-length logging); setup and the dense analysis screens read better on a large screen. Web goes
first because Yuta is most fluent there, and M1's riskiest assumption — that the logger gets used
every session — is tested fastest in a familiar stack. The backend, schema, auth and server logic
carry over to the native app unchanged.

**Consequences.** The native app stays cheap to add only if these hold from day one: a REST API
described by OpenAPI (no React-only RPC layer); planner, expenditure and plateau logic on the server;
bearer-token auth alongside cookies; client-generated ids and retry-safe writes. The web app has no
wide-layout design yet — all six artboards are phone width.

**Revisit if:** M1 shows the web logger is too clunky mid-session to use every time — then the
native app moves forward.

## 2026-09-19 — Offline scope: an online app with an offline gym session, not local-first

**Decision.** Only the gym session must work offline (S1): sets, the rest timer, last time's numbers
and the suggestion. Sets go into an on-device upload queue (IndexedDB) with client-generated ids and
upload whenever the app is open. Other screens show the last loaded data when offline. The web app is
installed to the home screen and requests persistent storage.

**Alternatives considered.** Local-first, with every table synced to the device by a sync engine
(PowerSync, which has web and Swift SDKs over Postgres).

**Reason.** The PRD only requires offline set logging, and several features cannot work offline at
all (plan generation, food lookup, AI estimates, health ingestion, expenditure). A sync engine on
every table is more machinery than the requirement. WebKit deletes script-writable storage after 7
days without interaction, except for home-screen web apps, and grants persistent storage by heuristic
(webkit.org, checked 2026-09-17) — hence the install requirement. Background sync on Safari is
unverified, so correctness must not depend on it.

**Revisit if:** A moment appears where the whole app is needed without signal.

## 2026-09-19 — Better Auth verified for web and a future native client

**Decision.** Better Auth stays. Checked against its docs (2026-09-17): Google sign-in by ID token
from a native client with per-platform client IDs, a bearer plugin for non-cookie clients, and
`user.validateUserInfo` to refuse any email not on the invite list. There is no Swift SDK; the native
app calls its endpoints directly. This closes the Phase 1 "verify allowlist support" item.

**Revisit if:** A later Better Auth release changes ID-token or bearer support.

## 2026-09-19 — TypeScript across the web app and the API

**Decision.** TypeScript for both the web app and the API server.

**Alternatives considered.** Go and Java/Spring Boot for the API.

**Reason.** No requirement needs either. Both would mean replacing Better Auth, which is a
TypeScript library and was verified for this app on 2026-09-17, and they lose type sharing between
the web app and the API. Speed at this scale (one user plus a handful of invitees, one person's sets
and meals per query) is set by network latency and database round trips, not by the language: the
things that will actually be felt are indexes, avoiding N+1 queries, putting the server in the same
region as the database, and the frontend bundle. Spring Boot's enterprise dominance comes from team
size and ecosystem, and the JVM's idle memory is a real cost on small hosting.

**Revisit if:** Planner, expenditure or plateau computation becomes CPU-bound. That piece can move to
a Go service behind the same REST contract without either client noticing.

## 2026-09-19 — Frontend: React + Vite, client-only; no SSR

**Decision.** The web app is React + Vite, rendered entirely in the browser, installed to the home
screen with a service worker. It has no server of its own and talks only to the API.

**Alternatives considered.**
- **Next.js.** Server-first: React Server Components, server actions and API routes all need a
  Next.js server. Paired with a separate API it means two servers, or static export and losing most
  of what Next.js offers. Server actions can only be called from Next.js pages, so every feature
  built on them would have to be rebuilt as REST for the Swift app.
- **Nuxt (Vue).** Same shape: built-in server routes pull the API toward the web pages. It can run
  with `ssr: false`, but then it only adds routing conventions over Vue + Vite.
- **Vue + Vite.** The same architecture as the choice, and viable. Rejected on Yuta's fluency and
  React's larger charting ecosystem. The dense screens (the S20 e1RM chart with four overlays)
  depend more on the chart library than on the framework.
- **SvelteKit.** Server routes carry the same coupling risk, and it is the least familiar stack.

**Why no SSR.** SSR helps with search indexing, link previews and a faster cold first load. Every
screen is behind login, so the first two do not apply. The third saves roughly one round trip,
because the server fetches data next to the database, but it barely matters here: the installed
app's shell loads from the service worker cache, so a client-only screen costs one API call if each
screen loads from a single request. Meanwhile SSR does nothing offline, where the gym screen must
render with no server at all, gives the Swift app nothing, and adds a second server that has to read
the session too.

**Revisit if:** A public page appears (an invitee landing page, a shareable progress card). Static
generation or SSR for that page alone, beside the app.

## 2026-09-19 — Backend: Hono with @hono/zod-openapi; the OpenAPI spec is the contract

**Decision.** The API is a separate Hono service. Routes are defined with `@hono/zod-openapi`, so
one Zod schema per route validates the request, types the handler and generates the OpenAPI spec.
Both clients build on that spec: the web app on TypeScript types derived from it, the Swift app on a
client generated from it. Better Auth is mounted in the same service at `/api/auth/*`, with Hono's
CORS middleware and matching `trustedOrigins` for the web app's origin (Better Auth Hono integration
docs, checked 2026-09-19).

**Alternatives considered.** Hono's RPC client (`hc`), which types the web app directly from server
code with no OpenAPI step.

**Reason.** The Swift app can only depend on HTTP and JSON, so the contract has to be
language-neutral. The RPC client works only for TypeScript clients. If the web app relied on it, the
OpenAPI spec would stop being the thing anyone depends on and could go stale unnoticed, which is
the React-only RPC layer the two-apps decision ruled out. Generating the spec from the validation
schemas means it cannot drift from the code.

**Unverified.** The details of Apple's `swift-openapi-generator`. Check them when the native app starts.

**Revisit if:** `@hono/zod-openapi` cannot express a needed endpoint shape, such as file upload for
photo estimates in M3.

## 2026-09-19 — Database: Postgres

**Decision.** Postgres.

**Alternatives considered.** SQLite.

**Reason.** Three writers (the web app, the future Swift app, and the offline retry queue) need
concurrent writes, foreign keys, check constraints and `ON CONFLICT` for retry-safe inserts. SQLite
would do the job on one server, but it ties the API to one machine with a persistent disk and a
backup scheme built by hand. Managed Postgres brings backups and is cheap at one user. The data is
relational (sets to sessions, plan meals to foods, batch yields to cooked portions), and `jsonb`
covers the few loose fields. Yuta uses Postgres by default.

**Revisit if:** Never at this scale.

## 2026-09-19 — Hosting: Vercel Hobby and Neon Free, both in Singapore; AWS Tokyo later

**Decision.** For now, the web app is served as static files from Vercel. The Hono API runs as a
Vercel function pinned to `sin1` (Singapore). Postgres is Neon Free in `aws-ap-southeast-1`
(Singapore). Cost is $0. **Later, the app will be redeployed to Yuta's own deployment platform, an
AWS stack in Tokyo (`ap-northeast-1`).** When that happens the database moves with the API, because
the two must stay in the same region.

**Why Singapore.** Neon has no Tokyo region (checked with Neon's region list, 2026-09-19); the
nearest are Singapore and Sydney. The API goes where the database is, not where the user is: a
request crosses Tokyo to Singapore once, and the several queries behind it stay local.

**Alternatives considered.**
- **Cloudflare Workers Free** with Hyperdrive to Neon. Also $0, and Yuta plans to learn Cloudflare,
  but the 10 ms CPU limit per request could bite plan generation, and Better Auth needs
  `nodejs_compat`.
- **AWS Lambda.** The most setup, and for new accounts API Gateway is free for only 12 months and the
  free tier is now credit-based. It fits better as the later home than as the first one.
- **An API in Tokyo against Neon in Singapore.** Rejected: every database query would cross the
  region gap instead of one request.

**Limits accepted** (vendor pages, 2026-09-19):
- **Vercel Hobby:** non-commercial use only; 1M function invocations and 4 h active CPU per month;
  one region; hitting a limit can pause that feature for up to 30 days.
- **Neon Free:** 0.5 GB storage per project, 100 CU-hours per month, a 6-hour restore window. The
  compute suspends after 5 minutes idle, which can't be disabled, and wakes in "a few hundred
  milliseconds", so the first request of a gym session pays that wake-up.
- **Watch:** M3's health samples are the likeliest thing to press on 0.5 GB.

**Portability rules, so the AWS move is a redeploy and not a rewrite:**
- No Vercel-specific APIs in the API code. Hono's app is built once; Vercel, Node and Lambda are thin
  entry adapters.
- No Neon-only features in the app: no Neon Auth, no reliance on branching at runtime. Plain
  Postgres through a standard driver.
- All configuration is environment variables: the database URL, auth secrets, the allowed web
  origin.
- The schema is changed only by versioned migration files in the repo, never by console edits, so
  that `pg_dump`/restore to the Tokyo database is the whole data move.

**Revisit if:** The AWS Tokyo platform is ready, or Hobby limits or Neon's 0.5 GB are reached first.

## 2026-09-19 — Food data: MEXT table, Open Food Facts, label photo in M2

**Decision.** A food comes from one of four sources, tried in order:
1. **Ingredients** come from 日本食品標準成分表（八訂）増補2023 (MEXT). The Excel file is imported
   into Postgres as seed data, and the app credits it as edited from the MEXT source.
2. **Packaged products** are looked up by barcode in **Open Food Facts**. Results are cached in a
   separate table, never merged into our own food tables.
3. **On a barcode miss**, the user photographs the nutrition label. Claude Haiku 4.5 extracts the
   values as schema-checked JSON, including the basis (per 100 g, per piece or per serving), and the
   user confirms them before the food is saved as their own.
4. **Manual entry** is the last fallback.

Nothing looked up or extracted is saved without the user confirming it. **Label-photo reading is new
scope and ships in M2**, not M3. The PRD's food-list bullet is updated to match.

**Alternatives considered.**
- Barcode only, with manual entry on a miss, which is the PRD's previous position.
- Label reading deferred to M3 alongside meal-photo estimates.
- Commercial JAN databases. None free was found with nutrition, and their pricing was not checked.

**Reason.**
- Users are in Japan and mostly cook at home. MEXT is authoritative for raw and cooked ingredients,
  free, and compatible with CC BY 4.0 (mext.go.jp, checked 2026-09-19).
- Open Food Facts has about 43k Japanese products with nutrition (API count, not cross-checked);
  whether that covers what Yuta buys is unknown.
- Its ODbL licence requires share-alike for derived databases. Keeping cached records in their own
  table makes the whole a collective database, which ODbL §4.5 exempts.
- A barcode miss without label reading means typing five numbers by hand, which is where logging gets
  abandoned. A label costs about $0.002 with Haiku 4.5 ($1/$5 per million input/output tokens).
- Japanese labels must show energy, protein, fat, carbohydrate and 食塩相当量, but fibre and sugar
  are optional and the basis varies, so extraction must capture the basis and allow missing fibre.

**Consequences.**
- M2 needs an Anthropic API key and a small prepaid balance. It is the first cost that isn't $0.
- Open Food Facts requires a User-Agent of the form `AppName/Version (contact)` and allows
  15 product reads per minute per IP.
- The MEXT table has no English version for the eighth edition, so food names are Japanese.

**Unverified.**
- Which cooked-state rows (ゆで, 焼き) and nutrient columns MEXT actually has.
- Whether an invite-only app counts as "publicly using" the data under ODbL.

**Revisit if:** Open Food Facts misses most of Yuta's packaged foods in the first two weeks of M2.

## 2026-09-19 — Morning weight source for M2: parked until two hardware tests are done

**Status.** Open. Decide before M2 starts. M1 does not need weight.

**Scale.** Eufy Smart Scale P2 Pro (T9149), which has Wi-Fi and Bluetooth. EufyLife writes weight,
body fat %, BMI and lean mass to Apple Health, and can also link to Fitbit.

**Established (primary sources, 2026-09-19):**
- **No web API for HealthKit, and no Web Bluetooth on iOS Safari (MDN).** The web app cannot read
  Health or the scale directly.
- **Apple encrypts HealthKit while the phone is locked.** Anything on the phone that reads Health
  (Shortcuts, Health Auto Export) only works after an unlock.
- **Shortcuts:**
  - There is no "new Health sample" trigger.
  - Time-of-day automations can run without confirmation.
  - Find Health Samples and a POST to a URL exist.
- **Health Auto Export:** REST automations need Premium (¥300/month, ¥1,100/year, ¥4,000
  lifetime). It runs by background refresh, only while unlocked, at times iOS chooses, and backfills
  missed data.
- **Fitbit and Google:** the legacy Fitbit Web API is being turned down in September 2026. Its
  successor, the Google Health API, exposes `weight` and body fat over REST with Google OAuth and
  webhooks.
- **Eufy:** no official cloud API. Home Assistant's `eufylife_ble` supports the P2 Pro over Bluetooth
  only, and needs an always-on device near the scale.
- **Unverifiable from docs:**
  - whether a Wi-Fi reading reaches Eufy's cloud without the phone
  - whether EufyLife writes to HealthKit without being opened
  - whether Eufy's Fitbit link is server-to-server, and whether it has moved off the legacy Fitbit API

**The tests** (Yuta, on his own hardware):
1. Phone in another room, weigh in, wait 10 minutes without opening EufyLife, then check Apple Health
   for the reading.
2. Link Fitbit in EufyLife, weigh in with the phone in airplane mode, then check Fitbit/Google from
   another device.

**Decision rule.**
- **Test 2 passes:** Google Health API webhook to our API. No phone involved, and it reuses Google
  sign-in.
- **Only test 1 passes:** Health Auto Export Premium POSTs to our API. It also covers M3's sleep, HRV
  and workouts.
- **Neither passes:** the same HAE setup, but each reading arrives at the next unlock.

**Rejected:**
- Manual entry, which breaks the M2 success criterion.
- A Shortcut fired when EufyLife closes: Wi-Fi sync means the app is never opened.
- A Shortcut fired by the morning alarm: it runs before the weigh-in and while locked.
- Terra and Junction, which need a native SDK.
- A Withings scale, which means buying hardware.

## 2026-09-19 — Error handling: three failure kinds, one error format, Sentry for tracking

**Decision.** Failures are handled by kind:
1. **No signal is not an error.** Sets go to the device queue, and the app bar's data-state slot
   (`docs/10` §7.4) shows the pending count. Other screens show the last loaded data with its age.
2. **Service down or slow:**
   - The message appears inline at the point of action, always with a way forward:
     - Open Food Facts down: photograph the label or enter it by hand.
     - Haiku down: the manual form, pre-filled with anything already read.
     - API unreachable: treated as kind 1.
   - Neon waking from scale-to-zero: the API retries once before reporting.
   - Google sign-in down: existing sessions keep working.
   - A missing morning weight is a gap the trend already tolerates.
3. **Server refuses the data** (validation, revoked access): the item stays in the queue, marked
   refused in the error colour, and can be edited or discarded. **A set is never dropped silently.**

**API side.**
- Every endpoint returns errors as RFC 9457 problem details (`type`, `title`, `status`, `detail`,
  plus our `code`).
- A retried write with the same client id returns the original result, not a duplicate or an
  error.

**Logging.**
- One structured JSON line per request in Vercel's function logs, with a request id. Stack traces
  are logged for kind 3 and for every 5xx.
- **Never logged:** food, weight or health values, meal photos, tokens. Log ids and error codes only.

**Error tracking: Sentry**, on both the web app and the API, on the free Developer plan.
- The API uses `@sentry/hono`. On Vercel, events must be flushed before the function returns, or
  they can be lost (Sentry docs, checked 2026-09-19).
- Collection is locked down: user info off, no HTTP bodies, and `beforeSend` strips any value field.
  The same never-log list applies.
- The Developer plan is $0, one user, error monitoring and tracing, and email alerts (sentry.io,
  2026-09-19). **Unverified:** its monthly error allowance and retention, which Sentry's pages list
  only for paid plans.
- Which region to store data in (US or EU) is chosen at org creation. Neither is in Japan.

**Alternatives considered.**
- Discarding refused sets automatically.
- Vercel logs only, with no error tracker.

**Reason.**
- A lost set is the one failure that breaks trust in the logger. Everything else degrades to a
  fallback.
- Sentry was Yuta's choice. It gives alerts before a user reports a problem, which Vercel's logs do
  not.

**Blocked on design.** Kind 3 needs an error colour, and the palette has none (`docs/05` §7.5). This
is Yuta's call, and it is needed before the first screen that can show a refused set.

## 2026-09-19 — Security baseline

**Decision.**
- **Secrets:** Vercel environment variables, with production and preview kept separate, plus a
  gitignored `.env.local`. Never in the repo, and never in the web bundle beyond public values.
- **Validation:** on the server, by the Zod schema on every route (the same schemas that generate
  OpenAPI). Values from label photos and Open Food Facts are untrusted input.
- **Transport:** HTTPS only (Vercel), and TLS to Neon.
- **Sensitive data:** email, bodyweight and composition, the food log, and later sleep, HRV and meal
  photos. None of it goes to logs or Sentry. Neon at-rest encryption is still to verify for `03`.
- **Photos:** label photos are sent to Anthropic for extraction and **discarded afterwards**. Only
  the confirmed values are stored.
- **Dependencies:** Dependabot weekly and grouped, with security updates immediately.
- **Worst case: reading or changing another user's data.** Every query is scoped to the session
  user in the data layer rather than per route, and tests attempt cross-user reads.
- **Second worst: running up the Anthropic bill.** Invite-only access, plus an Anthropic console
  spend limit if one exists (unverified).

**Alternatives considered.**
- A per-user daily cap on label reads (30 per day was proposed).
- Keeping label photos so a food can be re-checked later.

**Reason.**
- **The cap:** Yuta is the only user until invites open, so a per-user cap protects nothing. A
  console spend limit also covers a leaked key, which a cap would not.
- **Photos:** discarding them removes a class of sensitive data and keeps Neon's 0.5 GB for rows.

**Revisit if:** The first invitee is about to join. Add the per-user label cap before then.

## 2026-09-19 — Repo layout: pnpm monorepo, web and API deployed separately behind one origin

**Decision.** One pnpm-workspaces monorepo:

```
apps/web/        React + Vite, service worker, IndexedDB set queue
apps/api/        Hono app; entry adapters (Vercel, Node, later Lambda)
  src/routes/      one file per resource, @hono/zod-openapi
  src/domain/      planner, progression, expenditure, plateau (pure functions)
  src/db/          query layer, scoped to the session user
  migrations/      versioned SQL, the only way the schema changes
  seed/            MEXT import
packages/api-contract/  generated openapi.json + TS types, committed
ios/             reserved for the native app
design/  docs/  CONTEXT.md
```

- The web app imports only `api-contract`, never `apps/api`. The spec is generated by
  `getOpenAPI31Document()` from a script, with no server running, and typed with `openapi-typescript`.
- `apps/web` and `apps/api` deploy as two Vercel projects from the same repo, each with its own root
  directory. `apps/web/vercel.json` rewrites `/api/:path*` to the API project, so the browser only
  ever talks to the web origin.
- Better Auth `baseURL` is the web origin, so the Google callback returns through the rewrite.
  Cross-subdomain cookies stay off.
- Every API response carries `Cache-Control: private, no-store`.

**Alternatives considered.**
- One Vercel project serving the Vite build from the API's `public/`: needs the web build copied into
  `apps/api`, and whether client-side routes fall back to `index.html` there is unverified.
- Web and API on two `*.vercel.app` origins with CORS alone: rejected, see below.
- The web app importing server Zod schemas directly: the spec would stop being the contract.

**Reason.**
- `vercel.app` is on the Public Suffix List, so two `*.vercel.app` subdomains are different sites,
  and Safari blocks third-party cookies by default (WebKit, 2020-03-24). Better Auth's cookie docs
  name this failure and give the Vercel rewrite as the fix (checked 2026-09-19).
- Vercel's rewrite docs: external rewrites honour upstream cache headers by default for projects
  created on or after 2026-04-06. Per-user responses must not be cacheable, hence `no-store`.
- Better Auth 1.7 upgrade guide: behind Vercel, forwarded headers need no change.
- `swift-openapi-generator` supports OpenAPI 3.0 and 3.1 (README, 2026-09-19), so the committed spec
  also feeds the future Swift client.
- Vercel detects pnpm workspaces from the root lockfile and can skip unaffected projects.

**Unverified.** The latency the rewrite hop adds. Measure it in Vercel Observability → External
Origins once deployed.

**Revisit if:** The rewrite hop is measurably slow in the gym, or a custom domain is bought, which
allows a shared parent domain instead.

## 2026-09-19 — Client state: TanStack Query, one Zustand store, an IndexedDB set store

**Decision.** The web app keeps four kinds of state in four places:

| State | Lives in |
| --- | --- |
| Data from the API (routines, plans, history, charts) | **TanStack Query**, its cache persisted to IndexedDB so screens show the last loaded data offline |
| Sets not yet uploaded, and refused sets | **Our own IndexedDB store** (`idb`), one record per set keyed by its client id, written with `durability: "strict"` |
| The active gym session (current exercise, rest timer) | **One Zustand store**, in memory. The rest timer stores when rest started, taken from the last set's timestamp, never a countdown |
| One screen's own state (form input, open tab) | **React state**, plus the URL for anything worth linking to |

**Rule:** server data never goes into Zustand. One copy per fact.

**Alternatives considered.**
- TanStack Query's own offline mutations for the set queue, rejected (below).
- React Context for the active session, rejected: every screen reading it redraws on each timer tick
  unless the value is split and memoised (react.dev `useContext`).
- Redux, or Zustand for general app state: nothing on the device is shared across screens that the
  server cache does not already hold.

**Reason.**
- **Sets get their own store.** The TanStack persister writes the whole cache as one serialised value
  under one key, at most once per second (`throttleTime` defaults to 1000 ms). A set logged just
  before iOS ends the app could be lost, and a lost set is the one failure `06` forbids. One record
  per set, written the moment it's logged, closes that gap. The store also holds the refused state
  from the error-handling decision.
- **Strict writes.** The default `durability` leaves disk-flush behaviour to the browser; `"strict"`
  commits only once changes reach persistent storage. Baseline across browsers since May 2024 (MDN).
- **Zustand for the session.** Components bind to the store without a provider and redraw only when
  their selected slice changes (strict equality). State is in memory unless `persist` is added, which
  it isn't here: IndexedDB is the durable copy.

**Unverified.** When iOS ends a home-screen web app. Apple documents no rule; the separate set store
is a precaution against it, not a response to a documented behaviour.

**Revisit if:** The native app takes over gym logging; the web app's set store then only serves the
web client.

## 2026-09-19 — The three hardest technical problems

**Decision.** These three get extra design and test effort. Each plan goes into `docs/03`.

1. **Meal planner (S16).** A pure, deterministic function in `domain/`: the same food list and
   targets always give the same plan. Whether to use a solver library or hand-written code is
   decided when M2 starts.
2. **Exactly-once set sync (S1).** Client-generated ids, `INSERT … ON CONFLICT` on the server,
   one uploading tab at a time, and browser tests run in airplane mode. **Unverified:** how to
   make only one tab upload in Safari.
3. **Maintenance and expenditure maths (S18a → S21).** A smoothed weight trend plus energy
   balance over complete logging days only, with the weekly target change capped. The smoothing
   method and the intake source are picked before M2.

**Alternatives considered.** Automatic morning weight was the runner-up. Left out because it is
already parked behind the two hardware tests (2026-09-19 entry).

**Reason.** Each is the failure hardest to undo once live: a wrong plan feeds wrong amounts, a lost
or doubled set corrupts the training record, and a wrong maintenance figure skews every target
after it.

**Revisit if:** the native app takes over gym logging (problem 2 moves to the Swift client).

## 2026-09-19 — M1 tables, and "workout" instead of "session"

**Decision.** M1 has eight tables of our own beside Better Auth's four (`user`, `session`,
`account`, `verification`; core schema checked in Better Auth's docs, 2026-09-19):
`invite`, `exercise`, `exercise_setting`, `routine`, `routine_exercise`, `workout`,
`workout_exercise`, `set`. Charts (S7), last time (S2) and export (S10) are derived from `set`
and have no tables.

A gym visit is a **workout** in tables, API and code. The UI may still say "session".

**Alternatives considered.**
- Calling the gym visit `session` as the PRD does, rejected: Better Auth's `session` table is a login,
  and one word would mean two things in the code.
- Storing weight step, rest and rep range on `exercise`, rejected: seeded exercises are shared by
  every user, so per-user values need `exercise_setting`.

**Revisit if:** never, for the naming. The table list grows with M2 and M3.

## 2026-09-20 — Row ids: UUIDv7, generated on whichever side creates the row

**Decision.** Every table of ours uses a `uuid` primary key holding a UUIDv7.

- Rows created at the gym (`workout`, `workout_exercise`, `set`) get their id on the phone, from
  the `uuid` npm package's `v7()` (package major 14). That id **is** the primary key — there is no
  separate client-id column, and the server's `ON CONFLICT` on it is what makes set upload
  exactly-once.
- Rows created online default to Postgres 18's built-in `uuidv7()`.
- Better Auth keeps `advanced.database.generateId: "uuid"` so `user.id` is a `uuid` column our
  foreign keys can point at. On Postgres it lets the database generate the value, which means v4.
  Left as is: login rows gain nothing from time ordering.

**Alternatives considered.**
- Auto-incrementing integers, rejected: an offline phone cannot know the next number.
- `crypto.randomUUID()`, rejected: MDN documents it as v4 only, so ids would not be time-ordered.
- UUIDv4 everywhere, rejected: RFC 9562 §2.1 calls out v4's "poor database-index locality".
  Marginal at our size; v7 costs nothing over it.

**Verified 2026-09-20 (primary sources).**
- `uuidv7()` and `uuid_extract_timestamp()` are built in from Postgres 18
  (postgresql.org/docs/18/functions-uuid.html).
- Neon lists Postgres 14–18; 18 went GA on Neon 2026-05-01, Free plan included
  (neon.com/docs/postgresql/postgres-version-policy, neon.com/docs/changelog/2026-05-01).
- `uuid` npm exports `v7()`; current major is 14 (github.com/uuidjs/uuid).
- RFC 9562 §5.7: UUIDv7 is time-ordered on a 48-bit Unix-millisecond prefix.

**Revisit if:** we ever need ids short enough to type or read aloud.

## 2026-09-20 — Deletion rules, and conventions

**Decision — conventions.** `snake_case` column and table names, singular table names,
`created_at` and `updated_at` on every table, all instants stored as `timestamptz`.

**Decision — deletion.** No blanket soft delete. Deleted means deleted, with two exceptions.

| Deleted | Behaviour |
| --- | --- |
| A set | Hard delete. |
| A workout | Hard delete; `workout_exercise` and `set` cascade. |
| A routine | Hard delete. `workout.routine_id` is `ON DELETE SET NULL`; the workout copies the routine's name at start, so history still reads "Push A". |
| A custom exercise with sets logged | **Archived**, not deleted, so history keeps its name. With no sets logged, hard delete. |
| A seeded exercise | Cannot be deleted; hidden per user, stored in that user's `exercise_setting`. |
| An account (S10) | Hard delete of everything the user owns, on confirmation. Cascades from `user`. |
| A revoked invite (S9) | The `invite` row stays with `revoked_at` set; that user's Better Auth sessions are deleted so they are signed out everywhere; **their data stays**. |

**Reason for the revoke rule.** Revoking is "you cannot get in", not "your data is destroyed".
Account deletion already covers the destructive case, deliberately and with confirmation.

**Invites are a gate, not a feature.** Nothing references `invite`, and no other table's behaviour
depends on it. If the app ever opens to public sign-up, removing it is: drop the table, delete the
`validateUserInfo` allowlist check (verified 2026-09-17). That is also why revoke does not wipe
data — building a wipe into a mechanism we plan to delete would be the more expensive choice.

**Revisit if:** an invitee ever asks for their data to be removed without deleting their own
account — then the admin needs a delete-this-user's-data action, which is S10 run by the admin.

## 2026-09-20 — M2 schema: snapshots, rotation groups, and what is not stored

**Decision.** M2 adds eleven tables: `user_profile`, `body_measurement`, `food`, `rotation_group`,
`batch`, `goal_phase`, `day_routine`, `meal_slot`, `plan_day`, `plan_meal`, `plan_meal_item`.
Columns are in `docs/04`.

Three rules shape them.

1. **Past days keep their own numbers.** `plan_day` copies the phase's calorie and macro targets
   when the day is generated; `plan_meal_item` copies the food's per-100 g macros. Correcting a food
   or changing a phase later must not rewrite what an earlier day was aiming for or what it says you
   ate — S18a reads its maintenance estimate straight off those snapshots. Same rule as
   `workout_exercise` in M1.
2. **Derive rather than store.** No tables for the prep plan or grocery list (S17), the daily weight
   or its trend (S11), day completeness (S18), or batch yield (S13). Each is one query over rows that
   already exist; storing them would mean keeping two answers in step.
3. **Rotation is a group, not a pair.** `rotation_group` plus `food.rotation_group_id`. "Okra ↔
   broccoli ↔ green beans" is one group, and the planner picks from a set instead of walking a chain
   of pairs.

**Also decided.**
- Food macros are stored per 100 g of the named state, whatever basis the label or database used;
  the API converts before saving and the confirmation screen shows the original basis (S12).
  `piece_weight_g` carries unit foods (one egg = 55 g).
- `body_measurement` is `UNIQUE (user_id, source, external_id)`, so the same Apple Health sample
  arriving twice lands once — the same idea as set upload, different key.
- `user_profile.timezone` (default `Asia/Tokyo`) is what S11's "before 10:00 local" is read against.
- `goal_phase` has `UNIQUE (user_id) WHERE ended_on IS NULL`: one open phase at a time. Phases are
  kept, never overwritten.
- A day's type comes from `day_routine`, not from whether a workout happened. A missed session does
  not retroactively rewrite the plan.

**Revisit if:** reading intake over a long span gets slow — then a per-day rollup, written once a
day is complete, is the first thing to add.

## 2026-09-21 — M3 schema: a long health table, weekly estimates, protocols in code

**Decision.** M3 adds six tables — `health_sample`, `health_workout`, `health_sync_state`,
`expenditure_estimate`, `meal_estimate`, `protocol_suggestion` — plus
`body_measurement.lean_mass_kg` and `plan_meal_item.estimate_id`. Columns are in `docs/04`.

1. **Health data is one long table plus a workouts table.** `health_sample` holds every scalar
   reading as `metric` / `value` / `unit` / `started_at`; sleep stages become their own metric
   names. Apple workouts get `health_workout`, because a workout is an interval with average and
   maximum heart rate, not one number, and it can point at the gym visit you logged. Lean body mass
   goes on `body_measurement`, since it arrives with the same scale reading as weight and body fat.
2. **Per-metric sync state is stored.** `health_sync_state` is the one place M3 breaks M2's
   derive-don't-store rule, deliberately: a sync that ran and carried nothing leaves no sample
   behind, so a dead sync and a quiet week would look identical. No row means never synced.
3. **The weekly estimate carries its own targets.** `expenditure_estimate` records the week's
   expenditure, its inputs and the targets it produced; `plan_day` copies from the newest *applied*
   estimate, falling back to `goal_phase`. This supersedes the M2 note that S18a's estimate is
   applied by writing `goal_phase.calorie_target_kcal` — S21 is automatic and weekly, so `goal_phase`
   goes back to meaning what you decided rather than what the job last wrote. `applied_at IS NULL`
   is how a week with too few complete days is recorded without changing anything.
4. **Meal estimates convert to per 100 g on the way in.** `meal_estimate` keeps the raw totals the
   model returned, the portion weight it guessed, and whether the user edited them; the API divides
   and writes one ordinary `plan_meal_item` with `estimate_id` set. The gap between `raw_*` and what
   was saved is how we find out whether the provider is worth paying for.
5. **Protocols live in code; only suggestions are rows.** The catalogue — name, trigger, evidence
   tag, citations — is a typed constant in `domain/`, so a claim about the literature changes through
   code review. `protocol_suggestion` records what was offered, the trend numbers that triggered it,
   and whether it was taken; a dismissed protocol is not offered again while the same phase is open.
6. **No daily rollup table, and overlay toggles are client state.** Overlay series are summed at
   read time. `06`'s existing note stands: a rollup is the first thing to add if a long span
   measures slow.

**Corrected by verification (2026-09-21).** The first draft keyed `health_sample` on
`(user_id, source, external_id)`, copying `body_measurement`. **Health Auto Export's metric payload
carries no per-sample id** — a metric data point is `{qty, date, source?}`, and only a *workout* has
an `id` field (a UUID). So metrics key on the natural `(user_id, metric, started_at)` and workouts
key on the id they are given. `health_sample.external_id` is kept and left `NULL`, because a native
iOS client reading HealthKit directly would have `HKObject.uuid`.

Ingest is `ON CONFLICT … DO UPDATE`, not `DO NOTHING`. The PRD's edge case says a repeated reading
*replaces* the earlier copy — the opposite of the set upload, because a set is a fact the phone
observed once and a health sample is Apple's current answer, which Apple revises.

**Alternatives considered.**
- One wide row per day (`health_day`), rejected: every new metric is a migration and several HRV
  readings collapse to one number.
- A table per metric, rejected: six or seven more tables, and every overlay has to know which to read.
- Logging every import instead of per-metric state, noted as the better debugging tool but deferred;
  it costs a row per sync forever and makes the dashboard query harder.
- Updating `goal_phase` weekly, rejected: the phase row stops meaning what you decided.
- Letting `plan_meal_item` hold absolute macros via a `basis` column, rejected: more honest about an
  unweighed plate, but every intake reader — including S21's — would grow two cases.
- Seeded `protocol` / `protocol_source` tables, rejected: literature claims in rows nobody reviews.
- Recomputing protocols with nothing stored, rejected: the app would re-suggest a diet break every
  week after you declined it.

**Verified 2026-09-21 (primary sources).**
- Health Auto Export JSON format: metrics are `{name, units, data:[{qty, date, source?}]}` with no
  id; Workouts v2 requires `id`, `name`, `start`, `end`, `duration`
  (help.healthyapps.dev/en/health-auto-export/export-format and its metrics/workouts pages).
- Aggregated `sleep_analysis` gives `totalSleep`, `asleep`, `core`, `deep`, `rem`, `inBed` in hours
  plus `sleepStart`/`sleepEnd`; unaggregated gives raw segments (same source).
- All seven S19 metrics are supported, including Lean Body Mass, Resting Heart Rate and Heart Rate
  Variability (help.healthyapps.dev supported-data page).
- `HKCategoryValueSleepAnalysis` cases are `inBed`, `awake`, `asleepCore`, `asleepDeep`, `asleepREM`,
  `asleepUnspecified`, with `asleep` deprecated; the stage cases are iOS 16 / watchOS 9
  (developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis).
- `HKObject.uuid` exists and is assigned by HealthKit on creation, iOS 8+
  (developer.apple.com/documentation/healthkit/hkobject/uuid).

**Revisit if:** a native iOS client reads HealthKit directly — then `health_sample.external_id` is
populated and can become the de-duplication key, and `(user_id, metric, started_at)` relaxes to an
index. Also if the export's aggregation setting has to change after setup, which would collide
against existing `started_at` values and needs a migration, not a toggle.

## 2026-09-21 — Weight trend and expenditure: `weight_trend_balance_v1`

**Decision.**
- **Trend:** a time-aware EWMA at 10% per day, `a = 1 − 0.9^Δdays`. No trend line under 3 weighed
  days.
- **Expenditure:** mean confirmed intake on complete days − trend change × 7,700 kcal/kg ÷ window
  days, over a **trailing 14 days**. S18a (M2) and S21 (M3) share the formula.
- **Applying it:** S21 applies the estimate only when the newest 7 days hold **≥ 5 complete days**,
  and clamps the new calorie target to **±150 kcal** of the previous applied one. The TDEE is stored
  unclamped.
- **Schema:** `expenditure_estimate` gains `window_days` and `week_complete_day_count`.

Full spec in `docs/03` §8.3.

**Alternatives considered.**
- **Other smoothing methods:**
  - a 7-day moving average: abrupt drop-outs, a window that shrinks on missed days, more jitter
  - a Kalman or local-linear-trend model: most accurate and gives an uncertainty band, but the most
    maths to get right and the hardest to explain on screen
- **Other thresholds:** 6/7 (one missed day plus one dinner out skips the update) and 4/7 (a mean
  that skips the weekend understates intake — the error the app exists to catch).
- **Other windows:** one week (a 10-day EWMA barely moves in 7 days, so it is noisy) and 21 days
  (a real change takes three weeks to reach targets).
- **Other caps:** ±100 kcal (a 300 kcal misestimate at phase start takes 3 weeks to correct) and
  ±250 kcal (noise passes straight into the plan and the grocery list).

**Reason.** Deterministic, one number of state, explainable in a sentence on the S21 screen. The
14-day window matches S18a, so M2's read-only check and M3's automatic one cannot disagree about
the same fortnight.

**Revisit if:** estimates swing by more than the cap for several weeks running despite complete
logging. That would point at the smoothing, not at the user. `method` is versioned so a `v2`
leaves old rows honest.

## 2026-09-21 — Health Auto Export setup: three automations, daily grouping, per-user ingest token

**Decision.**
- **Three HAE REST automations:**
  - weight alone, Summarize OFF
  - sleep, resting heart rate, HRV, steps, active energy, body fat % and lean body mass, Summarize
    ON, Time Grouping = Days
  - Workouts v2
- **All three:** JSON, Batch Requests ON, Date Range "Previous 7 Days", hourly.
- **Endpoint:** `POST /api/ingest/health-auto-export` with `Authorization: Bearer <ingest token>`.
- **The token:** per user, shown once and stored hashed in a new `ingest_token` table. It
  authorises that one route only.
- The setup is fixed. Changing grouping later is a migration.

**Verified (help.healthyapps.dev, REST API automation page, 2026-09-21).**
- More than one metric in an automation is always aggregated.
- Summarize OFF gives individual points only for a single metric.
- Custom headers carry auth.
- Date Range offers Default / Since Last Sync / Today / Yesterday / Previous 7 Days.
- Background runs get about 30 s.
- Runs happen only while the phone is unlocked.
- REST automations need Premium, which closes the tier question left open in the Phase 1 pending
  list: ¥300/month, ¥1,100/year, ¥4,000 lifetime, per the 2026-09-19 entry.

**Consequences, and two corrections to the M2/M3 schema.**
- **HRV is one daily value**, not one row per reading.
- **Body fat and lean body mass move to `health_sample`.**
  - They arrive daily in a different request from the weight, in no fixed order, so attaching them
    to the day's weight row would race.
  - This supersedes the M3 entry's "lean body mass goes on `body_measurement`" for HAE data.
    `body_measurement`'s columns stay for hand entry and a future native client.
- **`body_measurement` now de-duplicates on `(user_id, source, measured_at)`.** The M2 key
  `(user_id, source, external_id)` would never have matched, because HAE's metric payload has no id.
  This is the same fault the 2026-09-21 verification found in `health_sample`, which the M3 fix did
  not carry back to M2.

**Alternatives considered.**
- **One automation, daily:** the simplest for invitees, but it loses individual weigh-ins, and
  S11's before-10:00 rule needs them.
- **Hourly grouping:** ~24× the rows against Neon's 0.5 GB, longer background runs, and sleep still
  has to be read per night.
- **"Since Last Sync":** smaller payloads, but a revision Apple makes to an older day never arrives.
- **Reusing a Better Auth session as the HAE credential:** it expires, and it authorises everything.

**Revisit if:** HAE background runs fail on the 7-day range (Activity Logs show timeouts). In that
case, try "Default" (yesterday plus today). Also revisit if the Google Health API path wins the
weight tests, which removes the weight automation.

## 2026-09-21 — Apple workout ↔ gym visit: overlap match, user can correct

**Decision.**
- **At ingest,** a `health_workout` is linked to the logged `workout` with the greatest time overlap
  (first set to last set), when:
  - the overlap is ≥ 50% of the shorter of the two
  - the activity type is a strength type
- **The user can correct it:** unlink, or pick another Apple workout from that day.
- **Corrections are permanent:** `health_workout.link_source` (`auto` | `manual`) records who
  decided, and the upsert never overwrites a manual choice.

**Alternatives considered.**
- **Automatic only:** a wrong match on a two-session day stays wrong.
- **Manual only:** always correct, but it is a tap per session that would mostly be skipped.

**Revisit if:** auto matches are corrected more than occasionally. That means the rule is wrong,
not the user.

## 2026-09-21 — Weekly job on a daily Hobby cron, with an inline fallback

**Decision.**
- **The cron:** one Vercel cron at `0 15 * * *` UTC (00:00–00:59 JST). It writes each user's
  `expenditure_estimate` once their local Monday has begun, and regenerates unconfirmed plan days.
  `UNIQUE (user_id, week_start)` makes a re-run harmless.
- **If the cron is missed,** the first request that needs current targets runs the same function
  inline.

**Reason.** Hobby allows only daily crons, with a trigger time anywhere inside the scheduled hour
(Vercel cron docs, checked 2026-09-21). A weekly estimate needs nothing finer. The fallback means
correctness never depends on the cron firing.

**Revisit if:** the move to Pro or AWS. Hourly then costs nothing to turn on.

## 2026-09-21 — Cost model and at-rest encryption checked

**Decision.** Recorded in `docs/03` §3 and §10.
- **Today:** $0 plus Anthropic cents.
- **1,000 users (hypothetical):**
  - Vercel Pro: $20/month per seat including $20 of usage; $0.60 per extra million invocations
  - Neon Launch: $0.106/CU-hour and $0.35/GB-month, about $20/month at an always-awake 0.25 CU
  - total ≈ $40–60/month plus Anthropic
- **Encryption:** Neon encrypts at rest with AES-256 on its NVMe volumes. This closes the "Neon
  at-rest encryption still to verify" item in the security baseline.
- **Unmeasured:** meal-photo cost, measured in M3 before any invitee has S22.

**Sources.** vercel.com/pricing, neon.com/pricing, neon.com/docs/security/security-overview, all
2026-09-21.

## 2026-09-21 — Auth and permissions (`docs/08`)

**Decision — chosen by Yuta.**
- **Sessions last 30 days, sliding** (`expiresIn` 30 d, `updateAge` 1 d), stored in Postgres with
  the cookie cache off. Revoke therefore takes effect on the next request whatever the lifetime is.
- **The admin is the `ADMIN_EMAIL` env var**, compared with the session user's email. There is no
  role column.
- **Signing out with pending or refused sets** shows a warning with Upload now, or Discard and
  sign out. Signing out also clears the cached API data on the device.
- **A revoked member has no access at all.** They are refused at sign-in with "access revoked",
  distinct from "not invited", and their data stays. Re-inviting restores it, which is also how a
  revoked member gets an export.

**Alternatives considered.**
- Sessions: 7 days (Better Auth's default) bounces an infrequent user to Google sign-in at the gym;
  90 days is weakest for a phone lost unlocked.
- Admin: the Better Auth admin plugin brings impersonation, a way into members' health data. An own
  role column is a second source of truth beside `invite`.
- Sign-out: keeping sets for the same user leaves one person's data on a device that may be passed
  on. Blocking sign-out traps a revoked user.
- Revoked users: an export-and-delete-only mode adds a second auth state to test on every route.

**Decided by default in `08`, not asked. Object and they change:**
- Account deletion needs a fresh session (Better Auth `freshAge`, 1 day) and a typed `DELETE`.
- Deleting an account deletes its `invite` row.
- The admin cannot delete their own account or revoke their own invite while `ADMIN_EMAIL` names
  them.
- Better Auth's rate limiter uses database storage, because the in-memory store is per serverless
  instance.
- Another user's row returns 404, never 403.
- A 401 never marks sets refused. Only a sign-in refused as `access_revoked` does.

**Verified 2026-09-21.**
- Better Auth, via Context7:
  - `expiresIn` and `updateAge` default to 7 days and 1 day.
  - `cookieCache` is off by default, `maxAge` 5 minutes.
  - `freshAge` defaults to 1 day and guards deletion.
  - `validateUserInfo` runs on every OAuth sign-in with the fresh provider email.
  - `rateLimit.storage: "database"` exists.
- Vercel cron docs: `CRON_SECRET` is sent as `Authorization: Bearer`, and the request is a GET.

**Revisit if:** a second admin is ever needed (then a role column), or a revoked member asks for
their data often enough that re-inviting them becomes a chore.

## 2026-09-21 — API design (`docs/07`)

**Decision — chosen by Yuta.**
- **One sync batch** is the only write path for workouts, workout exercises and sets,
  `POST /api/workouts/sync`. It returns 200 with a per-row `stored` / `unchanged` / `deleted` /
  `refused` result.
- **Edits and deletes travel in the same batch.** Each row is sent whole with `client_updated_at`,
  and the server applies it only when that value is newer than the stored one. This replaces `03`
  §8.1's `ON CONFLICT DO NOTHING`, and adds `client_updated_at` to the three tables.
- **JSON is camelCase.** The db layer maps to the tables' snake_case.

**Alternatives considered.**
- Per-row `PUT` by id: ~50 requests after a 40-set workout on gym signal, with ordering left to the
  phone.
- Online-only `PATCH` for edits: it fails exactly where typo fixes happen, mid-workout without
  signal.
- snake_case JSON: no mapping layer, but snake_case would run through the TypeScript and Swift
  code.

**Decided by default in `07`, not asked. Object and they change:**
- Every create takes a client-generated `id`, so a retried create returns the stored row.
- `DELETE` returns 204 whenever the row is gone.
- Last write wins; there are no ETags.
- No `/v1`. The contract grows by adding; a breaking change becomes a new route, and CI checks the
  spec diff.
- Cursor pagination only on growing lists; bounded lists are returned whole.
- Plan generation is an explicit `POST /api/plan-days/generate`, so no GET writes (except the cron,
  which Vercel calls with GET).
- Export is sectioned and paged, and the client assembles the file. Vercel caps response bodies at
  4.5 MB.
- The client resizes photos to ≤1568 px JPEG, and the API refuses anything over 4 MB.
- A weigh-in from Apple Health cannot be deleted in the app, because the next export would re-send
  it.
- Ingest never fails a payload for unknown metrics or bad points. It skips them and counts them,
  because a 4xx makes Health Auto Export drop the whole batch.

**Schema gaps found while mapping endpoints to tables, now fixed in `04`:**
- `user_profile.training_weekdays`: nothing recorded which calendar days are training days.
- `reference_food`: the MEXT catalogue had no table.

**Verified 2026-09-21.** Vercel functions limits: 4.5 MB maximum request **and** response body,
with 413 `FUNCTION_PAYLOAD_TOO_LARGE` above it.

**Revisit if:** the native app ships. Then breaking changes need a deprecation window, and the
no-`/v1` rule is tested for real.

### [2026-09-21] User flows: how workouts end, how days close, what a partial flow leaves

**Context.** Writing `docs/09` traced every flow from entry to success and found steps no doc
specified: a workout nobody finished, a day nobody closed, and a hand-set target that the weekly
estimate silently overrode.

**Decided (asked).**
1. **A workout with no new set for 3 hours counts as ended**, `ended_at` = the last set's
   `performed_at`, written by the phone on its next open. A long leg day with warm-ups runs about 2 h.
2. **One workout in progress per user**, with a Finish/Resume dialog. Enforced on the phone only; the
   server accepts what sync sends, because refusing a workout would refuse its sets.
3. **Finishing with zero ticked sets deletes the workout.** Unticked planned sets are never stored.
4. **The end-of-day check appears 60 minutes before the day routine's bedtime**, and as a "Yesterday"
   card on the next morning's first open. Dismissing it leaves the day incomplete.
5. **A plan day is confirmable for 7 days, then read-only** (409 `day_locked`).
6. **A late confirm never rewrites an applied estimate**; it feeds next week's window.
7. **Each step of a multi-step flow saves on its own.** No wizard drafts; the first missing
   prerequisite is the empty state and the resume point. Unconfirmed candidates are discarded; an
   abandoned meal estimate stays as an unapplied row.
8. **A hand-set calorie target wins until next Monday.** New column `goal_phase.calorie_target_set_at`;
   current targets are the newer of it and the newest applied estimate, and the next estimate clamps
   ±150 kcal from whichever was in force. Without this, once M3 applied its first estimate every later
   hand edit — including applying the S18a maintenance check — would have done nothing.

**Alternatives considered.**
- A resumable setup wizard with a draft table: a table and a state for data nobody confirmed.
- A hand edit that pauses weekly adjustment (`goal_phase.auto_adjust`): more control, but one more
  state to explain, and easy to forget it is paused.
- Keeping empty workouts: every mis-tap on Start would sit in history.
- Server-enforced single open workout: would refuse sets from a second device.

**Decided by default in `09`, not asked. Object and they change:**
- Health setup shows "Waiting for first data" until any `health_sync_state` row exists, and tells the
  user to run HAE's manual export once.
- A batch-cooked food with no batch newer than 7 days shows "Weigh this week's batch" on the prep
  screen.
- Routines, food edits and meal confirmations need a connection. Only the gym session is offline, as
  already decided.

**Changed elsewhere:** `04` (`calorie_target_set_at`, the current-targets query), `07` (`day_locked`),
`03` §8.3 (the clamp reads the target in force).

**Revisit if:** real use shows the 3 h timeout closing workouts that were still going, or the
"Yesterday" card being dismissed more often than used.

### [2026-09-21] Testing plan: real Postgres in Docker, Playwright on two engines, a phone checklist

**Decided (asked).**
1. **Must-automate** is the list collected from `03`, `07`, `08` and `09` (`docs/11` §2) — set upload,
   auth, domain maths, ingest, contract, and the four new flow rules.
2. **Tools:** Vitest for domain and for the API in process; Postgres 18 in Docker, one rolled-back
   transaction per test; Playwright on Chromium and WebKit with `setOffline`; `oasdiff` for breaking
   changes. oasdiff's OpenAPI 3.1 support and GitHub Action checked 2026-09-21.
3. **A 7-item manual checklist on a real iPhone**, run before each milestone and after any change to the
   offline path, with the result in the PR.
4. **Untested on purpose:** component and visual tests, load, model output quality, live third
   parties, and any coverage percentage.

**Alternatives considered.** A Neon branch per CI run (network-dependent, Free limits); PGlite (not
Postgres 18); Chromium only (would miss WebKit engine differences before the phone check).

**Decided by default, not asked.** CI on every PR to `develop` and `main`: typecheck, lint, Vitest,
Playwright, oasdiff, all required.

**Revisit if:** the screens stabilise after M1 — then component or visual tests start earning their keep.

### [2026-09-21] Deployment: staging on `develop`, migrations in the API build, add-first schema changes

**Decided (asked).**
1. **Three environments:** local (Docker Postgres), staging (`develop` → Vercel preview with
   branch-scoped variables → Neon branch `staging`), production (`main` → Neon `main`). Staging is
   where the iPhone checklist in `11` §3 runs, so production data is never the test bed.
2. **One Google OAuth client and one Anthropic key** across environments. Yuta is a solo developer
   and wants less to manage at first; the Anthropic key is to be split later so staging spend is
   visible on its own.
3. **Migrations run inside the API's Vercel build**, only on `main` and `develop`, with dbmate against
   the direct (unpooled) connection. A failed migration fails the build and the old deployment keeps
   serving.
4. **The add-first rule:** every migration works with the code already running. Drops, renames,
   `NOT NULL` and narrowing take two releases. Manual Neon snapshot before any destructive change.
5. **Monitoring, production only, $0:** Sentry new-issue emails, one uptime monitor on
   `/api/health` every 5 min, one cron monitor on the daily job, Vercel deploy-failure email.
   Anthropic spend is left for `13`.

**Found by verification (2026-09-21), and what it forced.**
- `vercel.json` rewrites are static, so staging's web app would have proxied to the production API.
  `vercel.ts` runs at build time and reads env vars → the rewrite target is `API_ORIGIN`. `03` §5
  updated.
- Vercel Hobby's Instant Rollback reaches only the previous deployment, leaves the database alone,
  and turns off auto-promotion until "Undo Rollback". Hence the add-first rule.
- Neon Free: 10 branches, a 6-hour / 1 GB restore window, one snapshot. Hence "check production
  within an hour of a migrating deploy".
- Sentry's free Developer plan includes one uptime and one cron monitor. An uptime check that queried
  the database would keep Neon awake (~180 CU-hours/month against Free's 100), so `/api/health`
  must not touch it.
- Vercel crons fire only on the production deployment, so staging has no cron.

**Alternatives considered.** Local + production only (the phone checklist would run on real data);
a Neon branch per PR via Neon's Vercel integration (platform-specific, eats the 10-branch limit,
already rejected for CI in `11`); migrations in a GitHub Actions job (races Vercel's deploy, DB
secrets in two places); migrations by hand (forgotten).

**Decided by default, not asked.** dbmate as the runner (plain SQL, no query-layer tie-in; the query
layer stays a build-phase choice). Seed data — the seeded exercises and the MEXT import — ships as
generated migrations. PR previews share staging's variables and never migrate. Uptime interval
5 minutes. `down` migrations are written but never run outside local.

**Revisit if:** staging Anthropic spend becomes noticeable (split the key); a second developer joins
(per-PR databases start earning their keep); the app moves to AWS Tokyo (migrations move to the
deploy pipeline there).

### [2026-09-21] Infrastructure and security: S3 backups, three DB roles, audit trail, compliance deferred

**Decided (asked).**
1. **Nightly `pg_dump` to S3** in Yuta's AWS account, `ap-northeast-1`, from a GitHub Actions
   schedule. Neon Free's 6-hour restore window alone would lose anything noticed the next morning.
   S3 because the future platform is AWS anyway.
2. **No custom domain.** The app stays on `vercel.app`. Accepted cost: at the AWS move every user
   re-enters the ingest URL in Health Auto Export, the Google redirect URIs change, and everyone
   signs in again.
3. **Anthropic: a dedicated `overload` workspace with a $10/month hard limit.** The per-user daily
   label cap is **not** built while Yuta is the only user; it is added before the first invitee.
4. **Three Postgres roles:** `overload_owner` (migrations), `overload_app` (runtime DML, no DDL),
   `overload_backup` (`SELECT` only).
5. **`audit_event`**, append-only, written in the action's transaction, one-year retention through a
   `SECURITY DEFINER` purge.
6. **Compliance deferred** until before the first real user. Invitees would be mostly in Japan and
   the Philippines. Findings kept in `13` §9 so the work starts from them.

**Found by verification (2026-09-21).**
- Anthropic: spend limits exist per organization and per workspace; a key belongs to one workspace;
  over the limit the API returns `400 invalid_request_error`.
- Neon Free: IP Allow is Scale-only; limited roles can be made by SQL; 6 h / 1 GB restore window, one
  snapshot, no scheduled backups. Neon documents nightly `pg_dump` to S3 via GitHub Actions, on the
  direct connection.
- Vercel Hobby: one WAF rate-limit rule per project, three custom rules; custom domains at no charge.
- APPI: covers non-profit activity, 事業 for a private friends' app is a grey zone; bodyweight and
  heart rate outside medical care are not 要配慮; the cloud exception depends on the provider's
  contract; photos to Anthropic are a foreign third-party transfer.

**Alternatives considered.** Neon restore window only (next-day damage unrecoverable); Neon Launch
for a longer window (monthly cost, backup still inside Neon); a custom subdomain of
`asakurayuta.dev` (recommended, rejected by Yuta for now); one owner role for everything (a leaked
runtime URL could drop tables); logs instead of an audit table (Vercel runtime logs are short-lived).

**Decided by default, not asked.** Backup at 03:00 JST, `age`-encrypted before upload, private key
offline, OIDC role that can only `PutObject`, 30-day lifecycle; S3 restore tested before M1 then
quarterly. Terraform for AWS pieces only, in `infra/aws/`; Vercel and Neon stay dashboard-configured.
One WAF rule, 300 req/60 s per IP on the web project's `/api/*`. `no-store` on every API response.
`audit_event.detail` jsonb for small non-sensitive facts.

**Revisit if:** the first invitee is near (§9 of `13`); the app moves to AWS (IaC for everything,
domain chosen then); a dump grows past what a GitHub runner handles comfortably.

### [2026-09-21] Repo configuration (Phase 5): mattpocock-skills on, no project MCP, two hooks

**Decided (approved as proposed).**
1. **Plugins:** `mattpocock-skills` on (the build phase starts with `/grill-with-docs`);
   `frontend-design` off, because it generates its own visual direction and `docs/05` is settled.
2. **No `.mcp.json`.** Neon and Sentry arrive as claude.ai connectors; a project copy would
   duplicate every tool. Read-only connector tools are allowed; every write, `run_sql` and
   `get_connection_string` asks.
3. **Hooks:** `pre-edit-branch-guard.sh` blocks edits on `main` (it deploys production and migrates);
   `stop-branch-drift.sh` reports when `main` is ≥6 commits behind `develop`. Both copied from lfca-lab.
4. **Permissions:** `dbmate`, `psql`, `pg_dump`/`pg_restore`, `terraform apply/destroy`, `vercel`,
   `aws`, `age` and every `gh` write ask; `.env`, `.env.local`, `.env.*.local`, `.env.production`
   and `.env.staging` reads are denied (`.env.example` stays readable). The repo is public.
5. **`CLAUDE.md`** points at `docs/` and holds only the rules a linter cannot catch, plus the
   hands-off workflow block and the polish gate.

**Alternatives considered.** A project `.mcp.json` with Neon, Sentry and Playwright, as lfca-lab has
(duplicates the connectors; Playwright is used as a test runner, not an MCP). Format and commit-gate
hooks now (no linter or formatter chosen yet).

**Revisit if:** the pnpm scripts land under different names than the allowlist guessed (run
`/fewer-permission-prompts`); a linter and formatter are chosen (add `post-edit-format`); the
connectors are not authorised in a terminal session (add Neon and Sentry to `.mcp.json`).

### [2026-09-22] Phase 6 review, group 1 (brief + PRD): six corrections

**Decided (asked, all accepted).**
1. **S11 states the requirement, not the route.** Morning weight arrives without manual entry; the
   two hardware tests (2026-09-19 entry) pick the route. Body fat % moves to S19 (M3), where HAE's
   daily automation carries it. Supersedes the route in "Bodyweight source: Eufy scale via Apple
   Health" (2026-09-15) as a PRD commitment.
2. **Protein is always per kg of bodyweight.** Range 1.6–2.2 g/kg; a cut defaults to 2.2 g/kg and is
   editable. The lean-mass rule (2.3–3.1 g/kg FFM) is kept as the reason, not as a calculation: M2
   has no lean-mass value and `04` never modelled one. Verified 2026-09-22: Helms et al. 2014
   (IJSNEM 24(2), 6 studies, "2.3–3.1 g/kg of FFM" scaled up with deficit and leanness); Morton et al.
   2018 (BJSM, PMID 28698222, breakpoint 1.62 g/kg, 95% CI upper ≈ 2.2); Bosy-Westphal et al. 2008
   (PMID 20054195: two of three foot-to-foot consumer scales within 1 kg of DXA lean mass on
   average, so scale accuracy was not the deciding reason). The ISSN 2017 position stand (PMC5477153)
   restates the range as "2.3–3.1 g/kg/d" without the FFM basis. Do not copy it as bodyweight.
3. **S21 carries the three limits** decided on 2026-09-21: ≥ 5 complete days in the newest 7,
   ±150 kcal per week, a hand-set target holds until the next update.
4. **S10 says what outlasts deletion:** `audit_event` rows for a year, backups for up to 30 days.
   `08` §6 and its test now say the same.
5. **"Workout" replaces "session" for a gym visit** in `01` and `02`, per the 2026-09-19 naming
   entry. S9's "sessions" (logins) stays.
6. **S18a reads the same trailing 14 days as S21**, shown once 14 complete days exist in total and
   labelled when fewer than 5 of the newest 7 are complete. Changed in `02`, `03` §8.3, `09`, `CONTEXT.md`.

**Alternatives considered.** A lean-mass protein basis (needs an M3 metric and a new column);
stripping IP and browser from a deleted user's audit rows (only if compliance review asks); S18a over
the user's first 14 complete days wherever they fall (can disagree with S21 about the same fortnight).

**Revisit if:** compliance review before the first invitee wants deleted users' audit rows anonymised.

### [2026-09-22] Phase 6 review, group 2 (design system + screens): contrast raised on information-carrying tones

**Decided.** Only the tones that carry information are raised to WCAG 2.1 AA. `text/quaternary` becomes
`#738393` (5.00:1 on ground, 4.66 on `surface/active`). `text/micro` and `text/faintest` are merged into it.
A new `text/placeholder` `#5A6673` (3.32:1) is limited to text of 24px and up, and its one use is the 56px unfilled
active-set figure. A new `line/control` `#55687A` (3.38:1) covers unlabelled controls (the inert check
cell) and raw weigh-in discs. `flag/dim` becomes `#947B45` (4.80:1) at 9px, and nothing in the app is set at 8px.
Supersedes the 2026-09-16 "six text tones, and the contrast cost left on the record" entry.

**Correction.** `05` §1.5 had counted the `line/field` border on labelled buttons as a failure. W3C's *Understanding
SC 1.4.11* ("Boundaries", checked 2026-09-22) says a control identified by its visible text needs no
contrasting boundary. `line/field` stays at `#2A3440` and is never the only thing that shows a control exists.

**Why.** Every UI feature would otherwise fail step 2 of the polish gate (`design:accessibility-review`). The
failing tones were also read in the worst conditions: "last time" at 3.32:1, and pre-filled reps at 2.56:1 that
are saved on COMPLETE SET, both mid-set in gym light.

**Alternatives considered.** Accept and record the deviation (the gate fails on every feature). A
user-controlled high-contrast mode (WCAG technique G174 allows it, but it doubles the token sets to test on an
invite-only app).

**Cost.** The bottom of the ladder is flatter: new quaternary against tertiary is 1.29:1, so rank below
tertiary is carried by size, case and tracking. Instrument's grammar is unchanged. The `.dc.html` artboards
still show the old tones, and `05` supersedes them.

**Revisit if:** the flatter ladder makes dense screens (2, 5) hard to scan once built.
