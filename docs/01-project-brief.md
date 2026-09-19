# 01 — Project Brief

_Working name: `overload`. Updated 2026-09-16._

## What it is

A mobile web app that logs weight training, plans and logs meals from a personal food list, pulls in Apple Watch and iPhone health data, and runs evidence-based bodyweight and diet coaching, so progress in one area can be read against the others.

## Problem and first user

The first user is Yuta. He trains with weights, tracks nothing today and guesses at last session's numbers. He weighs his food but doesn't log it, because every app he has tried makes him type everything in. He eats two meals a day from a short list of foods he likes (eggs, Instant Pot chicken breast, broccoli, okra, white rice), has no plan for splitting that food into meals around his schedule, and his weight isn't dropping. His Apple Watch Ultra 2, iPhone and Eufy smart scale collect sleep, heart rate, activity and bodyweight data that he never looks at.

Existing apps each cover one area: Hevy/Strong for lifting, MacroFactor for diet, Bevel for wearable data. None of them turns a food list and a schedule into a plan that logs itself, and none answers a question that spans areas, such as "my bench stalled for three weeks: was it the deficit, bad sleep or low carbs?"

Later users are people Yuta invites, each using the app for their own data.

## Principle

**The app enters data; the user confirms it.** Planned meals, health metrics and bodyweight arrive already filled in. The user corrects exceptions instead of typing the routine.

## Scale

Serious side project with no deadline. Personal-first, with invite-only access. It is not a public product.

## Success, measured by milestone rather than date

| Milestone | What has to be true |
| --- | --- |
| **M1 — Training log** | Every gym session for 4 consecutive weeks is logged in the app, and Yuta never has to guess a working weight. |
| **M2 — Meal plan + weight** | Yuta eats from a plan the app built from his food list and routine, confirms each day's intake in under a minute, and the morning weight arrives without manual entry. This runs for 4 consecutive weeks. |
| **M3 — Health + coaching** | Watch data arrives on its own, and any lift's e1RM chart can overlay intake, weight trend, sleep and HRV. Weekly targets adjust from the measured expenditure. Yuta needs no other diet app or coach. |

## Out of scope

- watchOS app. Sets are logged on the phone between sets.
- Native iOS app in v1. It is planned LATER (probably with M3) for the daily loop; the web app comes first. See the 2026-09-19 decision log entry.
- Social features: feeds, leaderboards, sharing, invitees seeing each other's data.
- Importing history from Hevy, MacroFactor or other apps (LATER, for future users).
- Automatic stall explainer. M3 shows overlays and the user reads the correlation.
- Recipe generation and cooking instructions. The plan works in foods and grams.
- Pound units. Everything is in kg.
- Public sign-up.

## Riskiest assumption

A home-built mobile web logger is fast and reliable enough mid-session that Yuta actually uses it every session. If it is clunkier than a paper note, no data flows and M2 and M3 have nothing to work with. The same test applies to the meal side: if confirming a planned day takes more than a minute, logging stops and the expenditure estimate is fed wrong data.
