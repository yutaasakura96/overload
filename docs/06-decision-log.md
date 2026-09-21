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
