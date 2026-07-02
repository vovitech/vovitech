# MVP Backlog

**Derived from:** `specs/mvp.md`, `specs/feedback-api.md`, `specs/data-model.md`, `specs/ios-client.md`, `specs/app-store-compliance.md` (all settled).
**Last updated:** 2026-07-02

This is the build plan: the settled specs decomposed into dependency-ordered, vertically-sliced work items. Each item is sized to roughly one focused work session and **points at** its spec section rather than restating it — the spec is the source of truth; if an item and a spec disagree, the spec wins.

**How to use it.** Work top-to-bottom within an epic; epics A → B → C is the critical path (the iOS client calls the backend; submission needs both). Each item is shaped like a GitHub Issue (title, depends-on, spec ref, scope, acceptance) so this file ports to Issues mechanically if you adopt them later — one item = one issue, "Depends on" = a task-list or blocked-by link.

**Status legend:** `TODO` · `IN PROGRESS` · `DONE` · `BLOCKED`

**Standing constraints (apply to every item):**
- Do **not** modify `.xcodeproj` / `.pbxproj` files — target/file wiring is done by a human in Xcode (`CLAUDE.md`, ios-client §8.1).
- `.git` is on a delete-blocked mount this session; if `git commit` fails on a stale `*.lock`, commit via plumbing (alternate `GIT_INDEX_FILE` + `commit-tree` + write the ref) or clear the locks on a machine with normal permissions.

---

## Pre-work

### P1 — (Optional) Write the auth spec · `TODO`
- **Depends on:** none
- **Spec:** referenced by ios-client §8.3 and feedback-api §2 but not yet written.
- **Scope:** The other specs defer Clerk internals (sign-in flows, token storage/refresh, session lifecycle, native-vs-hosted UI) to an "auth spec" that doesn't exist. Decide whether the Clerk SDK docs are enough or whether a short `specs/auth.md` is worth writing before B2.
- **Acceptance:** Either a committed `specs/auth.md`, or an explicit note in B2 that Clerk's docs are the reference and no spec is needed.

---

## Epic A — Backend (Vercel + Neon), build first

### A1 — Backend scaffold & environment · `TODO`
- **Depends on:** none
- **Spec:** feedback-api §2; data-model §1
- **Scope:** Next.js API-route project on Vercel, TypeScript, env/secret config for Clerk, Anthropic, UploadThing, and the Neon connection string across dev/prod. Provision the Neon database.
- **Acceptance:** `npm run dev` / `vercel dev` serves a health route; Neon reachable via the serverless driver from a route; secrets loaded from env, none committed.

### A2 — Database schema & migrations · `TODO`
- **Depends on:** A1
- **Spec:** data-model §2, §3
- **Scope:** Drizzle schema for `feedback` and `stored_photo` (four content fields on `feedback` — no calorie/portion/confidence columns), the `goal` Postgres enum, the FK + `ON DELETE CASCADE`, and both indexes. `drizzle-kit` migrations, one DB per environment.
- **Acceptance:** Migrations apply cleanly to dev; both tables + enum + FK + indexes exist; a manual insert/cascade-delete round-trips as specified.

### A3 — Model provider adapter (Claude Sonnet 5) · `TODO`
- **Depends on:** A1
- **Spec:** feedback-api §4 (esp. §4.1–§4.5)
- **Scope:** `generateFeedback(imageBytes, goal): ModelOutput` behind a thin interface. Claude Sonnet 5 via **tool-use** for schema-enforced output (`is_food`, `what_this_is`, `labels`, `reaction`). Shared system prompt + four voice blocks (§4.3), safety rules (§4.5), server-side schema validation with **one** repair retry then fail (§4.4).
- **Acceptance:** Returns valid `ModelOutput` for real food photos across all four goals; malformed output triggers exactly one repair then a clean failure; non-food returns `is_food: false`; voice blocks produce visibly different reactions to the same plate.

### A4 — `POST /api/feedback` route · `TODO`
- **Depends on:** A2, A3
- **Spec:** feedback-api §2, §3; data-model §2.3
- **Scope:** Multipart parse (`image`, `goal`, `store_photo`), Clerk JWT verification (401 on missing/expired), size/type guards, orchestrate the adapter, write the `feedback` row on `is_food: true`, assemble the §2.2 response, error envelope (§2.3), time budget (§3: model deadline that leaves room for the repair retry within `maxDuration`).
- **Acceptance:** Happy path returns §2.2 JSON; every §2.3 error code reachable under test; non-food writes no row and returns `id: null`; JWT required; total latency inside budget with a repair retry.

### A5 — UploadThing storage (opt-in) · `TODO`
- **Depends on:** A4
- **Spec:** feedback-api §1, §3; data-model §2.2
- **Scope:** Server-side upload from the route, **only** when `store_photo` is true AND `is_food` is true AND the model call succeeded. Deterministic key `ph_<feedback_id>`. Insert `stored_photo` only on upload success; upload failure returns 200 with `photo_stored: false` (never fails the request). Write order per data-model §2.3.
- **Acceptance:** Opt-out and failed-upload cases produce **zero** `stored_photo` rows; opt-in success stores the file under the deterministic key and inserts the row; upload failure still returns a reaction.

### A6 — Clerk `user.deleted` webhook · `TODO`
- **Depends on:** A2, A5
- **Spec:** data-model §4
- **Scope:** Vercel route handling the Clerk webhook with Svix signature verification. Read `uploadthing_key`s first, delete those files, then `DELETE FROM feedback` (cascade removes photo rows). Idempotent; non-2xx on partial failure so Svix retries.
- **Acceptance:** Deleting a user removes all their files and rows; re-delivery is a no-op; a partial failure returns non-2xx and recovers on retry.

### A7 — Retention reaper + orphan reconciliation (cron) · `TODO`
- **Depends on:** A5
- **Spec:** data-model §5
- **Scope:** Daily Vercel Cron. (1) Reap `stored_photo` where `expires_at < now()` — delete file first, then row. (2) Orphan sweep: list UploadThing files whose `ph_<feedback_id>` key has no matching row and whose upload time is older than a ~1 h grace, delete them (closes the file-without-row crash window). `feedback` rows are never touched.
- **Acceptance:** Expired photos + rows gone after a run; an orphaned file (row insert skipped) is cleaned on the next run; derived data untouched; deletes idempotent.

### A8 — Per-user rate limiting · `TODO`
- **Depends on:** A4
- **Spec:** feedback-api §2.3 (429), open question §6.2
- **Scope:** Per-user throttle returning `429 rate_limited` with the error envelope. Start with the proposed ~20/hour; make the limit a config constant. Backing store is additive (Upstash or an in-Postgres counter).
- **Acceptance:** Exceeding the limit returns 429 with `retryable: true`; limit is config-driven; normal use is never throttled.

---

## Epic B — iOS client (SwiftUI), after the API contract is real

### B1 — iOS app scaffold & state machine · `TODO`
- **Depends on:** A4 (contract firm; can start against the spec in parallel)
- **Spec:** ios-client §8
- **Scope:** SwiftUI app, iOS 17 deployment target, module groups (`Auth`, `Capture`, `API`, `Screens`), one `@Observable` `FeedbackSession` owning the state machine (idle / capturing / compressing / sending / result / error cases). async/await throughout; Dynamic Type baseline. **Human wires the Xcode project — no `.pbxproj` edits by tooling.**
- **Acceptance:** App builds and runs on an iOS 17 simulator; the state enum drives a placeholder screen per state; no fixed font sizes.

### B2 — Clerk auth & Auth screen · `TODO`
- **Depends on:** B1, P1
- **Spec:** ios-client §1, §8.3
- **Scope:** Integrate the Clerk Swift SDK (pinned version). Auth screen with **both** Sign in with Apple (native) and Google buttons, privacy-policy link in the footer. Session restore on launch (skip Auth when signed in), sign-out. Confirm the native SDK covers both providers; fall back to hosted only if it can't.
- **Acceptance:** Sign in with Apple and Google both succeed on device; returning users skip Auth; sign-out returns to Auth; SiwA is native (or the documented fallback).

### B3 — Goal picker & persistence · `TODO`
- **Depends on:** B1
- **Spec:** ios-client §1, §4
- **Scope:** Four goal cards (`lose_weight`, `less_sugar`, `build_muscle`, `eat_mindfully`), single-tap select, persisted in `@AppStorage`. First-run shows the picker; afterward the app opens to Camera with the goal as a tappable chip that reopens the picker (pre-selected).
- **Acceptance:** Goal persists across launches; first run lands on the picker, later runs on Camera; the chip reopens and pre-selects.

### B4 — Camera home screen: permissions + system picker · `TODO`
- **Depends on:** B3
- **Spec:** ios-client §1, §2, §4
- **Scope:** Home screen with goal chip, store-photo toggle (off by default, info popover), and a "Take a photo" button presenting `UIImagePickerController` (`.camera`). Permission gating on `AVCaptureDevice.authorizationStatus` (in-context explainer, never prompt on cold launch; denial → Settings path, re-checked on `scenePhase == .active`).
- **Acceptance:** Shutter presents the system camera when authorized; the prompt only fires behind the tap; denial shows the Settings recovery and recovers on return; toggle state persists and defaults off.

### B5 — Capture & compression pipeline · `TODO`
- **Depends on:** B4
- **Spec:** ios-client §3
- **Scope:** Off-main pipeline: `UIImage` from the picker → downscale longest edge ≤ 1568 px → `jpegData(compressionQuality:)` 0.8 → step down to 0.65/0.5 if > 2 MB → treat still-oversized as local `invalid_image`. Re-encode yields a clean JPEG with no GPS/EXIF. Hold the compressed bytes for retries.
- **Acceptance:** Output is always JPEG ≤ 2 MB at ≤ 1568 px with no location metadata; the same bytes are reused on retry with no re-capture.

### B6 — Networking layer · `TODO`
- **Depends on:** B5, B2, A4
- **Spec:** ios-client §5
- **Scope:** `URLSession` async multipart POST to `/api/feedback` (`image`, `goal`, `store_photo`); `Authorization: Bearer` with a JWT fetched immediately before the call; 35 s timeout; **401 → force-refresh + retry once**, second 401 → Auth; retryable errors re-send held bytes; one request in flight; forward-compatible response decoding; complete §2.3 error map.
- **Acceptance:** Real calls return and decode; 401 silently refreshes and retries exactly once; every error code maps to its state under fault injection; a 200 that fails to decode is handled as `model_failure`, never a crash.

### B7 — Loading & Result rendering · `TODO`
- **Depends on:** B6
- **Spec:** ios-client §6.1, §7
- **Scope:** Staged loading overlay on the frozen photo (0 s spinner → 3 s cancel → 8 s → 20 s copy → 35 s abort). Result screen: reaction as the **hero** in a Dynamic Type text style that scales without clipping (ScrollView fallback), `what_this_is` caption, non-food graceful redirect (not an error), single "Another photo" CTA. No calorie/label surface.
- **Acceptance:** Loading stages fire on schedule; cancel aborts and returns to Camera; reaction renders and scales at the largest accessibility sizes without clipping; non-food renders as a redirect, not an error.

### B8 — Account menu & delete account (5.1.1(v)) · `TODO`
- **Depends on:** B2
- **Spec:** ios-client §1; app-store-compliance §5.1
- **Scope:** Minimal Account menu reachable from the Camera screen with sign-out and **Delete account** (with confirmation). Delete triggers Clerk account deletion → `user.deleted` webhook (A6) purges data. Privacy-policy link also reachable here.
- **Acceptance:** Delete account removes the Clerk account and, via the webhook, all server data; sign-out works; the menu is reachable in ≤ 2 taps from Camera.

### B9 — Offline handling · `TODO`
- **Depends on:** B6
- **Spec:** ios-client §6.2
- **Scope:** App-wide `NWPathMonitor`; passive banner on Camera when offline (shutter stays enabled — capture is local); short-circuit submission when the path is unsatisfied; mid-request loss maps to the offline error state. No queuing/store-and-forward in v1.
- **Acceptance:** Offline shows the banner but still lets you shoot; submitting offline shows the offline error with Retry; regaining connectivity + Retry succeeds with the held bytes.

---

## Epic C — Compliance & submission, closes the MVP

### C1 — Privacy policy page · `TODO`
- **Depends on:** (content) A-epic decisions final; provider named (done: Anthropic)
- **Spec:** app-store-compliance §3
- **Scope:** Public, no-login, mobile-friendly policy at a stable URL (e.g. `/privacy` on the Vercel deployment). Two-tier data model stated plainly; processors named (Clerk, Vercel, Neon, UploadThing, Anthropic — note Anthropic doesn't train on API inputs by default); retention (photos 90 days, derived data until deletion); deletion rights; contact email. No claims the specs can't back.
- **Acceptance:** Live URL renders on mobile with no login wall; every §3.1 content checkbox satisfied; wording matches server behavior and the nutrition label.

### C2 — Privacy nutrition label & App Store Connect metadata · `TODO`
- **Depends on:** C1
- **Spec:** app-store-compliance §4
- **Scope:** Declare in App Store Connect: Photos (opt-in), Health & Fitness (the selected goal — no calorie data), User ID, Contact Info via Clerk, and Other Data (reaction/labels/timestamp), all linked to the user; nothing under tracking; the verifiably-absent list confirmed. Privacy-policy URL in the metadata field.
- **Acceptance:** Label, policy, and app behavior tell the same story (cross-checked as a set); no tracking declared; policy URL present.

### C3 — Camera usage string & Info.plist · `TODO`
- **Depends on:** B4
- **Spec:** ios-client §2; app-store-compliance
- **Scope:** Honest `NSCameraUsageDescription`; confirm no `NSPhotoLibraryUsageDescription` (capture only). (Human-owned Info.plist edits where needed.)
- **Acceptance:** Permission prompt shows the honest string; no unused privacy strings present.

### C4 — App Review preparation & 4.2 defense · `TODO`
- **Depends on:** B7, A4
- **Spec:** app-store-compliance §6, §7
- **Scope:** App Review notes (AI-generated goal-conditioned feedback; any Apple ID via SiwA, no demo creds; photograph any food or object; toggle off by default). Verify on a physical device: full loop works, four goals visibly differ, non-food redirect graceful, no medical claims across goals.
- **Acceptance:** Review notes written in App Store Connect; the physical-device checklist in §7 passes end-to-end at submission time.

### C5 — Manual single-user deletion runbook · `TODO`
- **Depends on:** A6
- **Spec:** app-store-compliance §5.2
- **Scope:** Document the runbook for "delete my data without closing my account": verify requester → run the data-model §4 sequence for that `clerk_user_id` → verify zero rows/files → respond within the 30-day SLA.
- **Acceptance:** A written, followable runbook exists; a dry-run against a test user leaves zero rows and files.

---

## Suggested sequence

Critical path: **A1 → A2 → A3 → A4** unlocks everything. A5–A8 and B1 can proceed once A4's contract is real; the iOS chain **B1 → B2 → B3 → B4 → B5 → B6 → B7** is mostly linear, with B8/B9 hanging off B6/B2. Epic C content can be drafted early but only *verified* once A and B are working. Nothing in C blocks build; C2/C4 are the final gates before hitting Submit.
