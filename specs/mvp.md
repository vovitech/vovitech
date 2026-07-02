# MVP Definition — Food Feedback App

**Status:** Locked for v1
**Last updated:** 2026-07-02
**Purpose:** Product-level definition of the minimum shippable app. This is the source that the technical specs are derived from. It answers *what* and *why*, not *how*. When a feature is proposed, it earns its place only if it serves the core loop below.

## What it is

A phone app you point at your food. It looks at the photo, knows the goal you picked, and reacts — a short, useful nudge in the spirit of *"Do you really want a second gallon of ice cream today?"* The user does no logging, no macro entry, no tapping through categories. They point, they shoot, they get read.

The photo is the input. The reaction is the product.

## The core loop

The entire MVP is one loop:

**Pick a goal → snap a photo → AI returns a reaction → it appears on screen.**

Everything else in the app is scaffolding around this loop. If it isn't part of this loop or legally required to ship, it is out of scope for v1.

## In scope (v1)

- Authentication (Clerk) — sign in with Apple and Google.
- Goal selection from a fixed short list (see below).
- Camera capture of a single food photo.
- One server call that runs a vision model against the photo + selected goal and returns reaction text (plus a one-line "what this is").
- Display of the reaction on screen.
- Two-tier storage (see Privacy).

## Out of scope (explicitly not v1)

- **Day-one memory.** The reaction is stateless — it reacts to one photo against one goal. It does *not* remember what you ate earlier today. (The ice-cream "second gallon today" framing is the eventual vision, not the MVP.)
- Macro/calorie logging, diaries, charts, streaks, history views.
- Social, sharing, friends.
- Custom or free-text goals.
- Cross-device sync beyond what auth gives for free.
- Notifications.

These are deferred, not rejected. The architecture should not preclude them, but v1 ships without them.

## The goals

Four fixed goals for v1, each with a distinct voice so the reaction feels tailored:

| Goal | What the reaction leans on |
|------|----------------------------|
| Lose weight | Calorie density, portion size |
| Eat less sugar | Desserts, sodas, hidden sugar |
| Build muscle | Protein presence; nudges when missing |
| Eat more mindfully | Gentler — prompts a pause, notices the food |

Four is enough. Goals can be renamed or extended later without touching the architecture. The choice of goals quietly picks the target customer, but does not affect App Store eligibility.

## Privacy & storage (two-tier)

Storage is deliberately split so product improvement never depends on hoarding sensitive images:

- **Always kept (low-risk):** derived, non-sensitive data — detected food labels, a one-line description, the selected goal, the reaction text, a timestamp. This is what powers product improvement. (No calorie or portion figures — cut as false precision and health-claim risk; the reaction says *what* the food is, which is enough to be useful.)
- **Kept only on opt-in (sensitive):** the raw photo, on a fixed retention window (target 30–90 days), used to improve the model/prompts. Off by default or clearly disclosed; never "forever."

Rationale: food photos capture faces, kitchens, and bystanders. Keeping only derived data by default makes the privacy story genuinely strong rather than merely compliant, and it's cheap to do now versus expensive to retrofit.

## Tech shape (high level — details live in the specs)

- **Client:** SwiftUI, native iOS.
- **Auth:** Clerk (Apple + Google). Confirm Clerk's native Swift SDK covers session handling and both buttons before committing; hosted web sign-in is the fallback.
- **Backend:** Vercel API route. Receives the photo, calls the vision model, writes derived data always and the image (via UploadThing, opt-in) as needed, returns the reaction.
- **Storage:** UploadThing for images (managed, chosen for convenience). Derived data in a cloud DB.

This section is a sketch. The binding contracts — screens, API shape, data model — belong in the technical specs.

## App Store requirements (must-haves to ship)

- **Minimum functionality (Guideline 4.2):** satisfied because the app delivers AI feedback, not just photo capture.
- **Sign in with Apple:** required because Google login is offered. Both buttons must be present. Clerk provides this.
- **Privacy policy:** required, especially given photo handling. Must disclose the opt-in photo retention and the derived-data collection.
- **Camera permission string:** `NSCameraUsageDescription` with a clear, honest reason.
- **Privacy nutrition label:** declare photo and derived-data collection accurately.

## Definition of done (v1)

A user can install the app, sign in with Apple or Google, pick one of four goals, take a photo of food, and receive an on-screen AI reaction tied to that goal — and the app is accepted into the App Store. Nothing more is required for v1.
