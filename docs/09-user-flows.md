# 09 — User Flows

_Written 2026-09-21. Screens are `docs/10`; endpoints are `docs/07`; auth states are `docs/08`. This
document gives the order of steps, what goes wrong at each one, and what is left behind when the user
stops partway. Where another doc already fixes the behaviour, this one points at it rather than
restating it._

Vocabulary is `CONTEXT.md`'s: **workout** (not session), **confirm**, **pending**, **refused**,
**complete day**.

## Rules that apply to every flow

1. **Each step saves on its own.** There are no wizard drafts and no draft tables. A flow left
   partway keeps every step already finished; the missing piece is shown as that screen's empty state,
   and that empty state is where the user resumes.
2. **A candidate is not a record.** Search results, barcode lookups and label reads are never saved
   until the user confirms them (`07` §4). Leaving the confirm screen discards the candidate.
3. **Failures come in three kinds** (`03` §7): no signal is not an error; a service down shows an
   inline message with a way forward (`03` §4); a refusal keeps the item, marked refused in the error
   colour, to edit or discard.
4. **A 401 is not a refusal.** It opens a sign-in prompt over the current screen and keeps pending
   work pending (`08` §5).
5. **Blocked on design:** every refused state below needs the error colour, which the palette does
   not have yet (`05` §7.5).

---

## M1 — Training log

### F1. Sign in

1. Visitor opens any route → redirected to `/sign-in?next=<path>` (`08` §5).
2. Taps **Sign in with Google** → Google consent → callback.
3. The invite gate runs (`08` §1).
4. Allowed → lands on `next`, or Today if there is none.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 2 | Google unreachable | Inline message on the sign-in page. Existing sessions elsewhere keep working |
| 2 | User cancels at Google | Back on `/sign-in`, no message |
| 3 | `not_invited`, `access_revoked`, `email_unverified` | The message for that code in `08` §1, on `/sign-in` |
| 4 | `next` is not a same-origin path | Ignored; lands on Today |

**Abandon:** nothing is created until the gate allows the sign-in.

### F2. First run

1. First sign-in lands on Today. With no routines, Today's training card shows the S4 empty state:
   **Create a routine** or **Start an empty workout**.
2. **Create a routine:** name → add exercises from the picker (F5) → per slot, target sets and rep
   range (default 6–10) → save.
3. **Start an empty workout:** goes straight to F3 with no exercises; the user adds them from the
   picker.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 2 | Save fails, API unreachable | Inline message on the routine screen, routine kept in the form. Routines are not queued offline; only the gym session is (`06`, offline scope) |
| 2 | 422, e.g. rep low > rep high | The field is marked; nothing is saved |

**Abandon:** a routine is saved only on **Save**. Leaving the form discards it.

### F3. Gym workout — the core flow

Works identically offline. Every write below goes to the IndexedDB set store first and uploads later
(`03` §8.1).

1. **Start.** Tap a routine (or **Start empty**). The phone creates the `workout` and its
   `workout_exercise` rows with UUIDv7 ids, copying rep range, increment and target sets (`04`).
   Last time and suggestions come from the offline cache (`07` §3, "Last time and suggestions").
2. **Log a set.** The active set row is pre-filled with the suggestion, or last time's numbers
   (S2, S3). Edit weight or reps if needed, optionally RIR/RPE and the warm-up flag (S6), tap the
   tick. The set is written locally before the screen updates.
3. **Rest.** The timer starts from the exercise's default rest, or 120 s (S5). Skip or +30 s. It
   counts from the set's `performed_at`, so a locked phone does not stop it.
4. **Change the workout.** Add, remove or reorder exercises; edit or delete a ticked set. None of it
   touches the routine (S4). Edits and deletes travel in the same sync batch (`07` §3.4).
5. **Finish.** Tap **Finish** → `ended_at` is set to now → summary.

**Ending a workout that was not finished cleanly** (decided 2026-09-21):

| Case | Rule |
| --- | --- |
| **No Finish tapped** | A workout with no new set for **3 hours** counts as ended, with `ended_at` = the last set's `performed_at`. The phone writes it the next time the app opens, offline or not. The next open shows "Push A ended at 10:14" and nothing more. Until the phone writes it, the server treats such a workout as ended for display |
| **Start while one is open** | A dialog: "Finish Push A first?" — **Finish** or **Resume**. One workout in progress per user. Enforced on the phone only; the server accepts what sync sends, because refusing it would refuse sets |
| **Finish with zero ticked sets** | The workout is deleted (a delete in the sync batch), not kept. A mis-tap on Start leaves nothing in history |

Planned sets that were never ticked are not stored. Only ticked sets become `set` rows.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 1 | No cached last time (first run offline, or a new exercise) | The row shows "first session" (PRD empty state) |
| 2 | No signal | Nothing different. The data-state slot shows the pending count (`10` §7.4) |
| 2 | Double tap on the tick | One set: the tick is disabled until the local write returns, and the id makes a repeat harmless anyway |
| 2 | Tab killed or phone locked with sets pending | Nothing lost; they upload on the next open (S1) |
| any | Refusal for one set (422) | F4 |
| any | Session ended while offline | F4 |

**Abandon:** every ticked set is kept. The open workout ends by the 3-hour rule.

### F4. Sync recovery

The uploader runs whenever the app is open and has signal (`03` §8.1). This flow is what the user
sees when it does not simply succeed.

1. **Pending.** The data-state slot shows *N* pending. No action needed.
2. **Uploaded.** The count drops; at zero the slot returns to its synced state.
3. **Refused (kind 3, e.g. 422).** The set stays in the store, marked refused, on the workout screen
   and in the slot. Tap it → **Edit** (re-queued with a new `client_updated_at`) or **Discard**
   (removed after a confirm). Never dropped silently.
4. **401.** A sign-in prompt opens over the current screen (`08` §5). Pending stays pending.
   - Same user signs in → upload resumes.
   - `access_revoked` → every pending set becomes **refused, access revoked**, and the sign-in page
     says "Your access was revoked." They can only be discarded.
   - A different Google account → F8's rule applies to the first user's sets before anything else.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 1 | API unreachable (Vercel or Neon down) | Still pending; the slot shows the age of the last sync. Kind 2 is not shown per set |
| 3 | User ignores a refused set | It stays, counted in the slot, until edited or discarded. Sign-out asks about it (F8) |

**Abandon:** nothing is lost by walking away. Pending and refused sets wait on the device.

### F5. Exercise library

1. From the picker (F2, F3) or Settings → Exercises: search the seeded ~50 plus the user's own (S8).
2. **Create custom:** name, equipment, default rest, increment → save. Visible only to this user.
3. **Remove:** a seeded exercise, or a custom one with history, is hidden (`exercise_setting`), never
   deleted — the API refuses with 409 `exercise_has_history` (`07` §3). It leaves the picker and stays
   in history (PRD edge case). A custom exercise with no sets and in no routine is deleted outright;
   one still in a routine returns 409 `exercise_in_routine`, and the screen says which routine.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 2 | Duplicate name among the user's own | 422, field marked |
| 2 | Created offline mid-workout | Kept on the phone with the workout and uploaded before it (`03` §8.1 step 6) |

**Abandon:** nothing saved before **Save**.

### F6. Admin: invite, revoke, re-invite

1. Admin opens `/admin/invites`. With no invites: "Only you have access."
2. **Invite:** type a Google email → add. Lowercased on save. Tell the person out of band; the app
   sends no email.
3. **Revoke:** tap an invite → confirm. The four steps in `08` §8 run: `revoked_at` set, sessions
   deleted, ingest tokens revoked, data kept.
4. **Re-invite:** a revoked row offers **Restore**, which clears `revoked_at`. Their data is back on
   their next sign-in.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 1 | A member opens the URL | The not-found screen (`08` §5) |
| 2 | Email already invited | 409 `invite_exists`, "Already invited" |
| 3 | The admin tries to revoke their own email | 409 `admin_account` (`07` §2) |

**Abandon:** each action is one save.

### F7. Export, then delete account

1. Account screen → **Export** → the client pages through every section and saves `overload-export-<date>.json` (S10, `07` §2).
2. **Delete account** → if the session is older than 1 day, sign in with Google again (`08` §6).
3. The screen lists what goes and offers export again. The user types `DELETE`.
4. Deleted → the device runs the sign-out wipe (F8) → `/sign-in`.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 1 | Export fails | Inline message, retry |
| 3 | The admin account | Refused, `admin_account` (`08` §6) |
| 3 | Pending sets on the device | F8's dialog first. Deletion never uploads them |

**Abandon:** nothing happens until `DELETE` is confirmed. The fresh sign-in in step 2 is harmless.

### F8. Sign-out

Exactly `08` §7. With nothing pending: wipe the cache and signed-in user, go to `/sign-in`. With
pending or refused sets: "*N* sets not uploaded yet" → **Upload now** (online only; continues only
when nothing pending is left) or **Discard and sign out**. **Sign out everywhere** is a separate
action on the account screen.

**Abandon:** closing the dialog cancels the sign-out. Nothing is lost.

---

## M2 — Meal plan + weight

### F9. Add a food

The order is the PRD's (S12): search, then barcode, then label photo, then manual.

1. **Search** the MEXT table (`GET /api/reference-foods`) → pick → confirm screen.
2. **Barcode:** scan → `GET /api/barcodes/{code}` → a candidate → confirm screen. If the list
   already has that barcode, open the existing food instead.
3. **Label photo** (when the barcode is not found): photograph the 栄養成分表示 → `POST
   /api/label-reads` → candidate with its basis (per 100 g, piece, serving or package) → confirm
   screen.
4. **Manual:** the same confirm screen, empty.
5. **Confirm screen:** values, basis, raw or cooked, piece weight, optional rotation group → **Save**
   → `POST /api/foods`. The API converts to per 100 g; the screen shows the converted values first.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 2 | 404 `not_found` | "Not in Open Food Facts" with **Photograph the label** and **Enter by hand** |
| 2 | 429 or 502 (Open Food Facts limit or down) | Inline message offering label photo or manual (`03` §4) |
| 3 | 422 `unreadable_label` | "Couldn't read the label", **Retake** or **Enter by hand** |
| 3 | 429 `label_cap_reached` | "Photo reads used up for today", manual form opens |
| 3 | 502 (Anthropic down) | The manual form opens, pre-filled with anything already read |
| 3 | 413 | "Photo too large" — the client resizes before upload, so this means a client bug |
| 5 | A field the label does not print | Left `null` on the candidate, shown empty, never guessed |
| 5 | 409 duplicate | "Already on your list", opens the existing food |

**Abandon:** the candidate is discarded. A label read already made still counts against the per-user
cap, because the model call happened.

### F10. Plan setup

Three independent saves. Today shows the first one missing as its empty state, in this order:

1. **Food list** — "Add foods, starting with a protein source" (PRD empty state) → F9.
2. **Goal phase** — type, start date, target rate; protein g/kg and fat %. Every default shows its
   source (S14). Calories come from the formula and are labelled provisional. Save → `POST
   /api/goal-phases`.
3. **Day routine** — for training and rest days: wake, work hours, training time, bed; training
   weekdays on `user_profile` → the app recommends meal count and times, with its reasoning and the
   "meal count doesn't change fat loss" note (S15) → accept or change → save.
4. With all three present, the client calls `POST /api/plan-days/generate` for the week → Today shows
   the plan.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 2 | Defaults need profile data (bodyweight, height) | 422 from `/defaults`; the profile fields are asked for first |
| 2 | A phase is already open | `phase_already_open` → "End the current cut on 11 Nov?" → `endPrevious: true` |
| 3 | Schedule leaves room for fewer than 4 meals | The recommendation says so and why; protein per meal rises to fit |
| 4 | Targets cannot be met from the food list | The plan is built anyway and carries `shortfalls` (PRD edge case). Never padded |

**Abandon:** each finished step stays saved. Coming back resumes at the first missing one.

### F11. A day of eating — the core M2 flow

1. Today shows the plan day's meals in time order, with targets, planned and confirmed totals.
2. For each meal, one of:
   - **As planned** — one tap.
   - **Adjust** — change grams or pieces, or swap in a food from the list.
   - **Replaced** — foods from the list, or by hand; in M3 also a photo or text estimate (F15).
   - **Skipped.**
   Confirming again later that day replaces the earlier confirmation (PRD edge case).
3. **End-of-day check** — appears as a card at the top of Today **60 minutes before the day
   routine's bedtime**. It lists unconfirmed meals: confirm each, or **Confirm all as planned**.
4. **Missed check** — the next morning's first open shows "Yesterday: 2 meals unconfirmed" with the
   same confirm-all. Dismissing it leaves yesterday incomplete, which is a real choice (`CONTEXT.md`).

**Closing a day** (decided 2026-09-21):
- A plan day stays confirmable for **7 days** after its date, in `user_profile.timezone`, then it is
  read-only. The API refuses a later confirm with 409 `day_locked`.
- **Confirming late never rewrites an applied estimate.** A day confirmed after Monday's estimate
  feeds the next week's window. The estimate is a snapshot.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 1 | No plan for today (`missing`) | The client calls `generate`; while it runs, the previous day's layout skeleton |
| 1 | Offline | Cached plan with its age. Confirming needs a connection; the button says so. Meals are not queued offline — only sets are (`06`) |
| 2 | 422 on an adjust | The item is marked; the meal stays at its previous status |
| 2 | Plan day older than 7 days | Read-only; no confirm buttons. The API returns 409 `day_locked` if called |

**Abandon:** each confirm is saved alone. An unconfirmed meal is not counted, and the day is
incomplete until it is confirmed or locks.

### F12. Weekly prep

1. Prep screen → the prep plan for the coming week: raw grams per food, from the plan and the current
   batch yield (S17).
2. **Grocery list** → the same, summed per food to buy.
3. After cooking → **Record batch**: food, raw weight, cooked weight, date → save. Future plan items
   use the new yield; past ones keep their snapshot.

**Decided by default, not asked:** a batch-cooked food with no batch newer than 7 days shows "Weigh
this week's batch" on the prep screen. Without any batch, cooked portions use the database's cooked
values, marked approximate (PRD empty state).

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 1 | No plan days generated for next week yet | The client calls `generate` for the week first |
| 3 | Cooked weight greater than raw for a food that loses water | Accepted (rice gains water); no validation beyond both > 0 |

**Abandon:** a batch is saved only on **Save**.

### F13. Maintenance check → apply by hand

1. Weight screen → the maintenance check card (S18a). With fewer than 14 complete days: how many
   remain.
2. With 14: mean intake, trend change and implied maintenance over the trailing 14 days, labelled
   with its method. Fewer than 5 complete days in the newest 7 adds a "too little recent logging" label.
3. **Apply to targets** → `PATCH /api/goal-phases/{id}` with `calorieBasis: "measured"` → the client
   regenerates the unconfirmed plan days. Never automatic.

**A target set by hand wins until next Monday** (decided 2026-09-21, and applies equally to plain
manual edits in F10): `plan_day` takes the newer of the newest applied `expenditure_estimate` and
`goal_phase.calorie_target_set_at`. The next Monday's estimate is clamped to ±150 kcal of the
hand-set number, so it adjusts from there instead of snapping back. Without this, M3's first applied
estimate would make every later hand edit a no-op.

**Abandon:** nothing changes until **Apply**.

---

## M3 — Health + coaching

### F14. Health setup

1. Health screen, never synced → setup steps plus "never synced" (PRD empty state).
2. **Create token** → label it (e.g. "Yuta's iPhone") → the token shows **once**, with copy (`08` §9).
3. In Health Auto Export: the three automations with the URL, header and settings in `03` §9.
4. **Decided by default, not asked:** the screen shows "Waiting for first data" until any
   `health_sync_state` row exists, and tells the user to run HAE's manual export once rather than wait
   an hour.
5. First data → the dashboard with per-metric "last synced" (S19).

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 2 | Token lost before it was copied | Revoke it and make a new one. It cannot be shown again |
| 3 | Wrong token or header | Nothing in the app; HAE's Activity Logs show the 401 (`08` §5). The setup screen says to look there |
| 5 | One metric never arrives | That metric's row stays at "never synced" while the others update |
| later | Sync stops | Per-metric "last synced" ages visibly (`03` §4) |

**Abandon:** an unused token can be revoked from the same screen.

### F15. Photo or text meal estimate

1. From a plan meal → **Replaced** → **Photo** or **Describe**.
2. `POST /api/meal-estimates` → an estimate is stored with `confirmedAt: null` and shown: calories,
   protein, carbohydrate, fat, fibre, labelled as an estimate (S22).
3. Edit if wrong → **Save** → `POST /api/meal-estimates/{id}/confirm` → the meal becomes `replaced`.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 2 | 502 (Anthropic down) | The manual replaced form opens (`03` §4) |
| 2 | 429 cap reached | Same, with the reason |
| 2 | 413 | As F9 |
| 3 | 422 | Field marked, estimate kept |

**Abandon:** the estimate row stays unapplied, so abandoned estimates still count when judging the
provider (`07` §5). The plan meal stays unconfirmed.

### F16. Weekly adjustment and plateau protocols

1. Monday, after the daily job or the inline fallback (`03` §8.4): Today shows a card with the new
   estimate, the change from last week and the new targets (S21). Unconfirmed plan days for the week
   are already regenerated.
2. **Not applied** (fewer than 5 complete days in the newest 7): the card says so, shows the estimate
   anyway, and says the previous targets stay.
3. **Plateau** (trend misses the phase's target rate for the protocol's number of weeks): a card
   offers the protocol with its evidence tag and sources (S23) → **Accept** or **Dismiss**. A
   dismissed protocol is not offered again while the phase is open (`06`).
4. The user can overrule the new target by hand → F13's rule.

| Step | Goes wrong | User sees |
| --- | --- | --- |
| 1 | The cron missed Monday | The first request that needs targets runs the job inline; the card appears on that open |
| 3 | Answered differently on two devices | 409 on the second; it shows the recorded answer |

**Abandon:** an unanswered protocol stays offered.

---

## Changed elsewhere by this document

- `04`: `goal_phase.calorie_target_set_at`; the "Current targets" query reads the newer of it and the
  applied estimate.
- `07`: `POST /api/plan-meals/{id}/confirm` and `/plan-days/{date}/confirm-all` can return 409
  `day_locked`.
