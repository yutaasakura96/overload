# START HERE

Cold-start context for a new project. Written 2026-09-15 at the end of a brainstorm held in another
repo (`kioku`, unrelated). **Nothing here is decided.** This is the raw material for Phase 1 of
`/project` (Brief + PRD): the problem in Yuta's words, what already exists, the facts that were
checked, and the questions still open.

`overload` is a working name for the folder, not a product name.

## 1. The problem, in Yuta's words

Yuta weight-trains and finds progress hard to track. Three areas, currently disconnected:

**Training.** For every exercise: what weight and reps did I do last time? How much have I
progressed over a given time span? Progressive overload is the thing that matters.

**Wearable and phone data.** An Apple Watch Ultra 2 (Yuta said "apple watch pro 2"; confirm the model)
and an iPhone both collect a lot of data, and none of it is used or shown anywhere. He wants a
dashboard.

**Bodyweight and diet.**
- Cut, bulk and maintenance should be run the way bodybuilders run them, not guessed.
- Plateau protocols ("carb loading to battle it") should be available.
- How much protein, carbs, fat and fiber does he actually need per day?
- Food logging is a pain because every item goes in by hand. He eats mostly the same food every day,
  so that should log itself. For a cheat meal, a photo or a short description should be enough to
  pull nutrition data from somewhere.
- Bodyweight should come in daily, ideally a morning weigh-in on an empty stomach.
- Recommendations should come from scientific papers and credible elite coaching, not folklore.

## 2. The thesis that came out of the brainstorm

Each area already has a good product (§3). **None of them answers a question that spans two areas,**
such as *"my bench stalled for three weeks: was it the deficit, bad sleep, or low carbs?"*
That combined view is the candidate differentiator. It is a hypothesis to test in Phase 1, not a
decision.

## 3. What already exists (researched 2026-09-15)

| Area | Reference product | What is worth taking |
| --- | --- | --- |
| Lift logging | **Hevy**, **Strong** | Previous session's weight and reps pre-filled next to each set. Strong leaves progression to the lifter. Hevy Trainer raises load when the top of the rep range is hit on every working set, and holds or drops it otherwise. |
| Diet coaching | **MacroFactor** | Estimates real energy expenditure from the weight trend plus logged intake, adjusts targets weekly, and absorbs logging errors. Also has AI photo logging now. **The closest reference for the diet half.** |
| Wearable dashboard | **Bevel** | Turns Apple Watch data into recovery, sleep, strain and stress scores, plus a strength trainer. Most core features went free in 2026; Pro is $14.99/mo or $99.99/yr. |
| Apple Health export | **Health Auto Export** (iOS) | Pushes 150+ Apple Health metrics as JSON or CSV to a REST endpoint on a schedule, with configurable auth headers. |
| Photo calorie apps | Cal AI, SnapCalorie | Mostly a caution; see §4.2. |

Not yet looked at, and worth a look: Fitbod, Alpha Progression, Boostcamp, Athlytic, Cronometer,
Carbon Diet Coach, Happy Scale / Libra (weight-trend apps), and smart scales that write to Apple
Health. **None of these were verified.**

## 4. Facts that constrain the design (verified 2026-09-15)

### 4.1 A web app cannot read Apple Health

Apple Health has no web or server API. The data stays on the device, and only a native iOS app can
read it through HealthKit, with the user's permission. Any web product needs an iOS bridge. Two ways
to get one:

- **Health Auto Export → own REST endpoint.** No Swift, fastest start, but depends on a third-party
  app.
- **Own small iOS companion app** that reads HealthKit and uploads to the backend.

Recommendation from the brainstorm: start with Health Auto Export and build the dashboard as a web
app. **Not decided.**

### 4.2 Photo-based calorie estimation is imprecise

- Calories are generally within 10–30% of true values, and worse on mixed, multi-ingredient meals.
- Macro estimates from photos have been measured at 48–66% error.
- Cal AI's accuracy claims have no independent peer-reviewed validation.

Implication: templated recurring meals (exact) should carry most of the logging, and photo or text
estimates should be reserved for occasional meals, where the error matters less. An adaptive
expenditure model like MacroFactor's also absorbs logging error through the weight trend.

### 4.3 The nutrition science, and how strong it is

- **Protein, general hypertrophy.** Morton et al. 2018 (49 trials, 1,863 participants): gains in
  fat-free mass plateau around **1.6 g/kg/day**, with the 95% CI extending to about **2.2 g/kg/day**.
  Protein contributed about 9% of strength gains; training itself contributed about 91%.
- **Contest-style cutting.** Helms et al. 2014 (JISSN): lose **0.5–1% of bodyweight per week**,
  eat **2.3–3.1 g/kg of lean body mass** in protein, get **15–30% of calories from fat**, and fill
  the rest with carbohydrate.
- **Plateaus and diet breaks.** The MATADOR study (Byrne et al., *Int. J. Obesity*, obese men): 16 weeks of 33%
  restriction, done in 2-week blocks alternating with 2 weeks at energy *balance*, lost weight more
  efficiently and showed less adaptive thermogenesis than continuous restriction. The key was
  *returning to maintenance*. That is **a diet break, not a carb load.**
- **Carb refeeds.** 2020 RCT in *J. Funct. Morphol. Kinesiol.* (n=27, resistance-trained): 2 high-carb days a week
  preserved fat-free mass and RMR compared with continuous restriction. **A published reanalysis
  comment disputes it** and says only dry fat-free mass differed. Small and contested.
- **Carb loading before a show.** Helms 2014 calls it theoretically motivated but understudied.

Implication: the app could attach an evidence strength to each recommendation instead of presenting
all protocols as equally established.

## 5. Direction suggested in the brainstorm (not decided)

- Build a **personal tool first**, not a product.
- **Core:** the training log plus the bodyweight trend.
- **Health data in** via Health Auto Export.
- **Differentiator:** the combined view (progress against intake, weight trend and recovery).
- **Diet coaching second.** MacroFactor already does it well and could stay in use at the start.

Possibly relevant, untested for this project: gyms often have poor signal, so set logging may need
to work offline. Kioku solved a similar problem with a localStorage outbox (Kioku ADR 0039). That is
an idea, not a requirement.

For reference only, not a decision: Yuta's most recent project (Kioku) uses Nuxt 4 / Vue, Postgres
via Drizzle, and Vercel + Neon. Stack is a Phase 4 question.

## 6. Open questions for Phase 1

These were asked at the end of the brainstorm and **not yet answered**:

1. **Audience.** Personal tool for Yuta only, or a product for others? This changes the iOS bridge
   choice, food-database licensing, auth, and scope.
2. **Replace or integrate.** Does this replace Hevy / MacroFactor, or read from them? Replacing is a
   much larger build.
3. **Where sets are logged.** On the watch mid-set, or on the phone between sets? This decides
   whether a watchOS app is in scope.

Also unresolved:

4. Which smart scale, if any? Does it write weight to Apple Health? (Unverified.)
5. Where the food data comes from: which nutrition database or API, and its licensing and cost.
   (Unresearched.)
6. Which Apple Watch and iPhone metrics actually matter for the dashboard, as opposed to showing
   everything.
7. Is photo or description logging an LLM call, a dedicated food-vision API, or both? (Unresearched.)
8. What does "progress over a time span" mean numerically: estimated 1RM, volume load, top-set
   weight, reps at a given weight? Probably several, and they need defining.

## Sources

- HealthKit has no web API: <https://www.themomentum.ai/blog/do-you-need-a-mobile-app-to-access-apple-health-data>,
  <https://developer.apple.com/forums/thread/668521>
- Health Auto Export REST API: <https://help.healthyapps.dev/en/health-auto-export/automations/rest-api/>,
  <https://github.com/Lybron/health-auto-export>
- MacroFactor: <https://macrofactor.com/ai-food-logging/>, <https://calorie-trackers.com/reviews/macrofactor/>
- Hevy vs Strong: <https://www.sensai.fit/blog/hevy-vs-strong-2026>
- Bevel: <https://www.bevel.health/>, <https://kiledjian.com/2026/07/07/bevel-turns-apple-watch-data.html>
- Photo calorie accuracy: <https://www.intakenutrition.io/blog/is-cal-ai-accurate-what-public-reviews-and-ai-research-actually-suggest>,
  <https://clinicalnutritionreport.com/research/ai-photo-calorie-benchmark-2026/>
- Morton 2018: <https://pubmed.ncbi.nlm.nih.gov/28698222/>
- Helms 2014: <https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/>
- MATADOR: <https://www.nature.com/articles/ijo2017206>
- Carb refeed RCT and reanalysis: <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7739314/>,
  <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7739255/>
