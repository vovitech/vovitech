# Spec: iOS Client (MVP)

**Status:** Settled (v1)
**Derived from:** `specs/mvp.md` (locked), `specs/feedback-api.md` (settled), `specs/data-model.md` (settled)
**Last updated:** 2026-07-02
**Owner:** Hien Nguyen

Defines the native iOS client for the MVP core loop: sign in → pick a goal → snap a photo → see the reaction. Covers the screen flow and every intermediate state, camera permissions, capture and compression, the `POST /api/feedback` call, response and error rendering, the loading experience, and offline behavior. **Not covered here:** Clerk auth internals (sign-in flows, token mechanics beyond what the API call needs — separate concern), the server side of the API (feedback-api spec), persistence tables (data-model spec).

Decisions locked in discussion (2026-07-02):

1. **Opt-in toggle lives on the camera screen**, always visible, off by default. The user sees exactly what each shot does — this is the client half of the two-tier privacy story.
2. **Goal is picked once and persisted**; the app opens to the camera afterward, with the current goal shown as a tappable chip that reopens the picker.
3. **System camera (`UIImagePickerController`, `.camera` source)**, not a custom AVFoundation capture UI. Goal chip and opt-in toggle live on the home screen; the shutter presents Apple's camera. The returned image is re-encoded to JPEG by us, so no HEIC ever reaches the network regardless of the camera's output codec. A custom capture UI was **rejected** as the most expensive, most bug-prone component in the client for no MVP-critical gain — this is the deliberate scope-saving call.
4. **`@AppStorage` for the two client prefs** (goal, opt-in), a deliberate deviation from the project's SwiftData standard (§8.2).
5. **Minimum iOS 17** (required by Observation + Clerk). See §10.

---

## 1. Screen flow

Five screens; navigation is a single state machine, not a stack the user can wander:

```
[Auth] ──signed in──▶ [Goal Picker]* ──goal chosen──▶ [Camera] ──shutter──▶ [Loading] ──200──▶ [Result]
                        * first run only;                 ▲                     │                  │
                          afterwards skipped              │◀───── error ───────┘                  │
                                                          │◀──────────── "Another photo" ─────────┘
```

- **Auth:** shown when no Clerk session exists. Sign in with Apple and Google buttons, both present (App Store requirement). On success → Goal Picker (first run) or Camera.
- **Goal Picker:** the four fixed goals (`lose_weight`, `less_sugar`, `build_muscle`, `eat_mindfully`) as large single-tap cards. Selecting one persists it and lands on Camera. Reachable later via the goal chip on Camera; reopening pre-selects the current goal.
- **Camera (home screen):** goal chip (top), store-photo toggle (§4), and a large "Take a photo" shutter button — **no live preview**. Tapping the shutter presents the system camera (`UIImagePickerController`); the returned photo flows to Loading. All pre-flight states (permissions, offline, errors) render here.
- **Loading:** the captured photo frozen full-screen with a progress overlay (§6.1).
- **Result:** the reaction (§7). One CTA: "Another photo" → Camera.

Signed-out at any point (session revoked, sign-out) → Auth. The only chrome beyond the loop is a minimal **Account menu** reached from the Camera screen (icon in a corner), holding sign-out and **Delete account** — the latter is an App Store requirement (Guideline 5.1.1(v)) for any app offering account creation, and it triggers Clerk account deletion, which fires the `user.deleted` webhook that purges the user's data (data-model §4). No history, no tab bar, no other settings in v1. See `specs/app-store-compliance.md`.

## 2. Camera permission states

The home screen checks `AVCaptureDevice.authorizationStatus(for: .video)` before presenting the picker:

| State | Behavior |
|---|---|
| `.notDetermined` | Tapping "Take a photo" requests access, then presents the picker on grant. The prompt only ever fires behind the user's tap, never on cold launch. |
| `.authorized` | Tapping "Take a photo" presents the system camera immediately. |
| `.denied` / `.restricted` | The shutter is replaced by a denial state: short copy + "Open Settings" button (`UIApplication.openSettingsURLString`). Re-checked on `scenePhase == .active` so returning from Settings recovers without relaunch. |

(`UIImagePickerController` would itself prompt on present, but we gate explicitly so the denial state and copy stay under our control.)

`NSCameraUsageDescription`: *"The camera is used to photograph your food so the app can react to it. Photos are analyzed and not kept unless you turn on photo storage."* (Final copy may be edited; the honesty requirement is binding.)

No photo-library access and no `NSPhotoLibraryUsageDescription` in v1 — capture only.

## 3. Capture & compression

Target (binding, per API spec §2.1): **JPEG, ≤ 2 MB, longest edge ≤ 1568 px.**

Pipeline, run off the main actor once the picker returns a `UIImage`:

1. Receive the `UIImage` from `UIImagePickerController` (`.originalImage`), orientation already normalized.
2. Downscale so the longest edge ≤ 1568 px (`UIGraphicsImageRenderer` at the target size — fast, memory-safe).
3. Encode with `jpegData(compressionQuality:)` at 0.8; if > 2 MB, step down 0.65 → 0.5. At ≤ 1568 px, 0.5 is comfortably under 2 MB for any real photo; if somehow still over, treat as `invalid_image` locally (never send an oversized body — a 413 is a client bug by contract).
4. Re-encoding from `UIImage` produces a clean JPEG with **no GPS/EXIF** — location never leaves the device by construction.

The compressed bytes are held in memory for the duration of the request so error retries re-send the **same bytes** — no re-capture, no re-compress (§5).

**HEIC note (resolved by construction):** the API spec's open question §6.3 recommends client-side transcoding. Whatever codec the camera captures, we hand the network a JPEG we encoded ourselves from a `UIImage`, so HEIC never reaches the server and there is no transcoding branch to maintain.

## 4. Store-photo opt-in toggle

- Lives on the camera screen, persistent and always visible (e.g. "Keep photo to improve the app" with an info popover explaining the 90-day window).
- **Off by default.** State persisted in `@AppStorage` (§8.2); the client owns the state per API spec §2.1 — `store_photo` is sent explicitly on **every** request, no server default.
- The info popover discloses: opt-in only, raw photo kept 90 days to improve the model, everything else (labels, estimate, reaction) is kept regardless — mirroring the MVP's two-tier language.
- The response's `photo_stored` field is not surfaced in v1 UI (storage is best-effort server-side; a false when the toggle was on is a logged non-event, not a user problem).

## 5. Networking: `POST /api/feedback`

Single endpoint, `URLSession`, async/await, multipart body per API spec §2.1 (`image`, `goal`, `store_photo`).

- **Auth header:** `Authorization: Bearer <jwt>` where the JWT comes from `Clerk.shared.session?.getToken()?.jwt`, fetched **immediately before** the request (Clerk session tokens are ~60 s-lived; never cache one across user think-time).
- **Client timeout: 35 s** (`timeoutIntervalForRequest`), per API spec §3. Expiry renders the same UI as the server's `504 timeout`.
- **401 handling (binding):** on `401 unauthorized`, force-refresh the token (Clerk `getToken` with cache skip), retry the request **once** with the same bytes. Second 401 → sign the user out to the Auth screen. No loop, no third attempt.
- **Retry semantics for all retryable errors:** re-send the identical compressed JPEG held in memory. Re-capture only if the user backs out to Camera.
- One request in flight at a time; the shutter is disabled while Loading is showing.

### 5.1 Response decoding

Decode the §2.2 shape. Client-binding rules: `reaction` always present; `calories` and `portion` nullable (non-food); `confidence` drives de-emphasis (§7). Unknown fields ignored (forward-compatible decoding). A 200 that fails to decode is treated as `model_failure` UI (should be impossible — server schema-validates — but the client never crashes on a body).

### 5.2 Error map (API spec §2.3, complete)

| Code | UI state | User action |
|---|---|---|
| `invalid_image` (400) | Return to Camera with inline notice "That photo didn't work — try another" | Re-capture |
| `invalid_goal` (400) | Generic error state; log locally as client bug | Retry |
| `unauthorized` (401) | Invisible: forced refresh + one retry (§5). Second 401 → Auth screen | Sign in again |
| `image_too_large` (413) | Generic error; log as client bug (compression contract was violated) | Retry (recompressed) |
| `model_failure` (502) | "Something went wrong — try again" + Retry button | Retry same bytes |
| `timeout` (504) & client 35 s expiry | Same as `model_failure` | Retry same bytes |
| `rate_limited` (429) | "You're going fast — give it a minute" cooldown; shutter disabled ~60 s | Wait |
| Undecodable error body / unknown code | Generic retryable error | Retry |

The envelope's `message` is safe to show verbatim (API spec §2.3) and is preferred over local copy when present.

## 6. Loading & offline

### 6.1 Loading experience (against the 35 s ceiling)

The captured photo stays frozen full-screen with a dimmed overlay:

| Elapsed | Overlay |
|---|---|
| 0 s | Spinner + "Reading your plate…" |
| ~3 s | Cancel button fades in |
| ~8 s | Copy → "Still looking…" |
| ~20 s | Copy → "Almost there…" |
| 35 s | Abort → `timeout` error state |

Cancel aborts the `URLSessionTask` and returns to Camera. The server may still complete and write a derived row — accepted; it is harmless and consistent with the data model.

### 6.2 Offline

- `NWPathMonitor` runs app-wide. When unsatisfied, the Camera shows a passive banner ("No connection — you can shoot, but feedback needs internet").
- The shutter stays enabled (capture is local). Submission short-circuits: if the path is unsatisfied at send time, skip the request and show an offline error state with Retry.
- Mid-request connection loss (`URLError.notConnectedToInternet`, `.networkConnectionLost`) → same offline state.
- **No queuing or store-and-forward** in v1; a photo taken offline is retried manually or abandoned.

## 7. Result rendering

- **Reaction is the hero:** large type, top of screen. It is the product. Rendered with a Dynamic Type text style (not a fixed point size) so it scales with the user's setting; the layout uses a `ScrollView` fallback so the largest accessibility sizes never clip the reaction off-screen.
- Below: `what_this_is` as a one-line caption.
- **Calories:** rendered as a range — "550–750 cal" — with a confidence tag. `confidence == "low"` de-emphasizes the block (smaller, secondary color) per API spec §2.2. Never a single number.
- `labels` and `portion` are **not rendered** in v1 — derived data, not product surface.
- **Non-food (`is_food: false`):** same screen; the reaction (a graceful redirect, e.g. "That's a keyboard — point me at your plate") + `what_this_is`; no calorie block. Not styled as an error.
- Single CTA: "Another photo" → Camera. No share, no save, no history entry.

## 8. Architecture & standards

### 8.1 Structure

- **SwiftUI + Observation:** one `@Observable` `FeedbackSession` model owns the state machine (idle / capturing / compressing / sending / result / each error case as an enum with payloads). Views are thin renderers of that enum.
- **async/await throughout;** no Combine, no callbacks.
- **Dynamic Type everywhere:** all text uses semantic `Font.TextStyle`s (no fixed sizes), supports the full range including accessibility sizes, and every screen degrades gracefully (scrollable content, no clipping) at the largest settings. The Result screen is the binding case (§7).
- Modules (groups, not packages, in v1): `Auth` (Clerk wrapper surface only), `Capture` (`UIImagePickerController` wrapper + compression), `API` (client, DTOs, error map), `Screens`.
- Lives under `ios-app/` per repo layout. **`.xcodeproj`/`.pbxproj` files are never modified by agents** (project rule); target/file wiring is done by a human in Xcode.

### 8.2 Persistence deviation (documented)

`CLAUDE.md` mandates SwiftData for persistence. v1 persists exactly two scalars — selected goal and store-photo opt-in — and no records. These use `@AppStorage` (UserDefaults). **Deliberate deviation:** SwiftData enters when the first record-shaped feature (history, deferred in the MVP) lands; wrapping two scalars in a model container adds ceremony without benefit. Revisit at history time.

### 8.3 Dependency: Clerk iOS SDK

The only third-party dependency (Swift Package). Provides Sign in with Apple (native), Google OAuth, session management, and `getToken()` for the JWT.

**Unresolved flags:**

1. The SDK is **pre-1.0** (v0.5x as of July 2026) — API churn is possible; pin the version and budget for upgrade breakage.
2. Native-vs-hosted sign-in UI for both providers must be confirmed against the current SDK before build (MVP names hosted web sign-in as the fallback). This belongs to the auth spec, not here — flagged only because it gates the Auth screen's shape.

## 9. What this spec deliberately excludes

Clerk integration internals (sign-in flows, token storage, session lifecycle → auth spec), server behavior (feedback-api spec), persistence schema (data-model spec), App Store submission assets and the compliance surface — privacy nutrition label contents, screenshots, the privacy-policy link, and the exact Account-menu / delete-account copy and flow (→ `specs/app-store-compliance.md`; this spec only notes that the Account entry point exists per §1), analytics/telemetry (none in v1), and iPad/landscape layouts (iPhone portrait only in v1).

## 10. Decisions & open questions

1. **Minimum iOS: 17 (decided).** Required by the Observation framework and the Clerk SDK. iOS 17 runs on iPhone XS/XR (2018) and newer; the only excluded devices are iPhone X / 8 / 8 Plus (2017 and older, 9+ years old). This comfortably meets the "support the last ~5 years of phones" goal — coverage actually reaches ~8-year-old hardware. Dropping to iOS 16 to reach 2017 devices would forfeit Observation and is not worth it. Confirm the Clerk SDK's stated minimum doesn't exceed 17 before build.
2. **Rate-limit cooldown length** (open) — the 429 cooldown (~60 s) should track the server's limit once the API spec's open question §6.2 is settled.

## 11. Done when

A user on a physical device can: sign in with Apple or Google; pick a goal (once) and change it from the camera; grant camera permission via the in-context prompt (and recover from denial via Settings); toggle photo storage on the camera screen; take a photo that is compressed to ≤ 2 MB JPEG at ≤ 1568 px with EXIF stripped; see the staged loading experience; and receive a rendered reaction — including the non-food redirect and the confidence-styled calorie range. Every §2.3 error code renders its mapped state under test (fault injection), 401 silently refreshes and retries exactly once, cancel/timeout/offline behave as §6, and no `.xcodeproj` file was touched by tooling.
