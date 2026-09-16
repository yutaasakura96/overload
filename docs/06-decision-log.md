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
Stack, database and hosting choices, the food database source and its licensing (it now also needs barcode lookup), the photo/text estimation provider, and which Health Auto Export tier is needed and what it costs.
