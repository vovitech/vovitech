# MVP Milestones

**Derived from:** `artifacts/BACKLOG.md` and the settled specs in `specs/`.
**Purpose:** Give the MVP path visible checkpoints where each milestone ends with something new that works and can be demonstrated.

Use this as the product-facing progress map. Use `artifacts/BACKLOG.md` as the implementation task list. If this file and a spec disagree, the spec wins.

## Milestone 0 — Project Rules Are Agent-Ready

**What works:** Any coding agent can enter the repo, read the project rules, and understand the source of truth, engineering philosophy, safety rules, and build/test expectations.

**Includes:** `AGENTS.md`, `CLAUDE.md`, settled specs, and backlog alignment.

**Demo:** Ask an agent where to implement backend, iOS, tests, and state-machine logic; it should answer from repo guidance without needing tribal knowledge.

**Proof:** Guidance files are committed; `git status` is clean; specs and backlog agree on the MVP surface.

## Milestone 1 — Backend Skeleton Runs

**What works:** The backend app can run locally and expose a health endpoint.

**Includes:** Backend scaffold, TypeScript, Vercel/Next route structure, environment loading, basic health route.

**Demo:** Start local dev server and call the health endpoint.

**Proof:** `npm run dev` or `vercel dev` serves a successful health response; no secrets are committed.

**Backlog:** A1.

## Milestone 2 — Data Layer Exists And Deletes Correctly

**What works:** The database schema exists and supports the core persistence contract.

**Includes:** Neon Postgres, Drizzle schema, migrations, `feedback` table, `stored_photo` table, goal enum, indexes, FK cascade.

**Demo:** Apply migrations, insert a feedback row with an optional stored-photo row, delete the feedback row, and observe photo-row cascade.

**Proof:** Migration output plus a small verification script or test proving insert, lookup, and cascade delete.

**Backlog:** A2.

## Milestone 3 — AI Adapter Produces Valid Feedback

**What works:** A provider adapter can turn an image plus goal into validated model output.

**Includes:** `generateFeedback(imageBytes, goal)` interface, Claude Sonnet 5 tool-use call, shared prompt, four goal voice blocks, schema validation, one repair retry.

**Demo:** Run a local adapter test against sample food and non-food images.

**Proof:** Fast tests for validation and repair behavior; manual or recorded run showing four different goal reactions for the same food image.

**Backlog:** A3.

## Milestone 4 — Feedback API Works Without Photo Storage

**What works:** The core server loop works: authenticated request in, reaction out, derived data stored.

**Includes:** `POST /api/feedback`, multipart image parsing, goal validation, Clerk JWT verification, model adapter orchestration, derived-data write, error envelope, non-food in-band response.

**Demo:** Send a photo and goal to the local API and receive `reaction`, `what_this_is`, `labels`, and `photo_stored: false`.

**Proof:** Behavior tests cover happy path, non-food, invalid goal, invalid image, unauthorized, model failure, timeout shape, and response schema.

**Backlog:** A4.

## Milestone 5 — Privacy Storage Path Works

**What works:** Opt-in raw-photo storage works without weakening the opt-out path.

**Includes:** UploadThing integration, deterministic photo keys, `stored_photo` inserts only on upload success, best-effort upload failure handling, user-deletion webhook, retention reaper, orphan reconciliation.

**Demo:** Submit once with `store_photo: false` and once with `store_photo: true`; only the opt-in request creates a stored photo. Delete a test user and verify rows/files are gone.

**Proof:** Tests prove opt-out creates zero `stored_photo` rows, upload failure still returns a reaction, deletion is idempotent, and expired/orphan files are reaped.

**Backlog:** A5, A6, A7.

## Milestone 6 — iOS Shell Runs With Explicit State

**What works:** The native app builds and shows the core screens as a state machine, even before real auth/camera/API are wired.

**Includes:** SwiftUI scaffold, iOS 17 target, module groups, `FeedbackSession` state machine, placeholder Auth, Goal Picker, Camera, Loading, Result, and Error views.

**Demo:** Run the app in simulator and move through states using controlled local triggers or preview/debug controls.

**Proof:** `xcodebuild` succeeds; state-machine unit tests cover valid transitions and make invalid states unrepresentable or unreachable.

**Backlog:** B1.

## Milestone 7 — User Can Sign In And Pick A Goal

**What works:** A real user can authenticate, choose a goal, relaunch, and return to the correct app state.

**Includes:** Clerk SDK, Sign in with Apple, Google sign-in, session restore, sign-out, goal picker, persisted selected goal, camera goal chip.

**Demo:** Sign in, pick `build_muscle`, close and reopen the app, land on Camera with that goal selected, then change it from the chip.

**Proof:** Device verification for both auth providers; fast tests for goal persistence and first-run routing.

**Backlog:** P1 if needed, B2, B3.

## Milestone 8 — User Can Capture A Valid Photo Payload

**What works:** The iOS app can request camera permission, take a photo, compress it correctly, and retain bytes for retry.

**Includes:** Camera screen, opt-in toggle, permission gating, system camera, Settings recovery, JPEG compression, EXIF stripping, retry-byte retention.

**Demo:** On a physical device, grant camera permission, take a photo, and inspect the generated JPEG constraints.

**Proof:** Tests or instrumentation verify longest edge <= 1568 px, size <= 2 MB, JPEG output, no location metadata, same bytes reused for retry.

**Backlog:** B4, B5.

## Milestone 9 — End-To-End Food Reaction Works

**What works:** The actual MVP loop works on device against the real backend.

**Includes:** iOS networking, auth token fetch, multipart upload, 401 refresh once, timeout, retryable errors, loading states, result rendering, non-food redirect.

**Demo:** Sign in, pick a goal, photograph food, see a goal-specific reaction. Photograph a non-food object and see a graceful redirect.

**Proof:** Physical-device walkthrough; API tests still pass; iOS tests cover response decoding, error mapping, retry behavior, cancel, timeout, and offline state.

**Backlog:** B6, B7, B9.

## Milestone 10 — Account And Privacy Obligations Work

**What works:** The app satisfies the required privacy and account-management flows before App Store submission.

**Includes:** Account menu, sign-out, delete account, privacy-policy links, live privacy page, manual data-deletion runbook, camera usage string, no photo-library permission.

**Demo:** From Camera, open Account, view privacy policy, sign out, sign back in, delete account, and verify backend data is gone.

**Proof:** End-to-end deletion verification; privacy policy live on mobile; runbook exists; Info.plist privacy strings match behavior.

**Backlog:** B8, C1, C3, C5.

## Milestone 11 — Submission Candidate

**What works:** The app is ready to submit for App Store review.

**Includes:** Privacy nutrition label, App Store metadata, review notes, physical-device acceptance run, four-goal voice spot-check, non-food review path, no medical claims.

**Demo:** Run the complete reviewer path from a fresh install: sign in with Apple, pick a goal, take a food photo, get a reaction, try a non-food photo, inspect privacy/account affordances.

**Proof:** Completed compliance checklist; screenshots/notes prepared; physical-device walkthrough recorded or documented; `git status` clean at the release candidate commit.

**Backlog:** C2, C4.

## Working Principle

Each milestone should be merged only when its demo works through the public interface. If the demo is hard to perform or the behavior is hard to test without reaching into internals, refactor the interface or state shape before moving on.
