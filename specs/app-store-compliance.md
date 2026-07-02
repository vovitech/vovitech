# Spec: App Store Compliance & Privacy (MVP)

**Status:** Settled (v1)
**Derived from:** `specs/mvp.md` (locked), `specs/feedback-api.md`, `specs/data-model.md`, `specs/ios-client.md` (all settled)
**Last updated:** 2026-07-02
**Owner:** Hien Nguyen

The concrete, checkable list of everything that must be true to pass App Store review and be honest about data. Every item is a checkbox: it is either verifiably done or the app does not ship. This spec is the submission gate — the "Done when" sections of the other specs make the app work; this one makes it shippable.

One deliberate addition to settled scope is flagged inline (§5.1): Guideline 5.1.1(v) requires in-app account deletion, which no other spec provides for. It is specified here because `ios-client.md` §9 explicitly excluded App Store submission concerns.

---

## 1. Sign in with Apple — Guideline 4.8

Required because Google login is offered (third-party login service). Non-negotiable; this is a mechanical rejection if missed.

- [ ] Sign in with Apple button is present on the Auth screen alongside Google (both buttons, per ios-client §1).
- [ ] The Apple button is given **equivalent or greater prominence** than Google: same size tier, not below it, not visually subordinated (HIG requirement reviewers do check).
- [ ] Sign in with Apple is the **native** flow (Clerk SDK native SiwA per ios-client §8.3), not a web redirect, unless the auth spec's hosted fallback is invoked — in which case both providers fall back together.
- [ ] Signing in with Apple with "Hide My Email" works end-to-end (relay email lands in Clerk; nothing server-side assumes a real email — data-model §4 stores no email at all, so this should be free — verify it).

## 2. Camera permission — Guidelines 5.1.1 / 2.1

### 2.1 The `NSCameraUsageDescription` string

- [ ] `NSCameraUsageDescription` present in `Info.plist` with this copy (from ios-client §2; edits allowed, honesty binding):

  > "The camera is used to photograph your food so the app can react to it. Photos are analyzed and not kept unless you turn on photo storage."

- [ ] The string stays true as written: it must continue to name (a) the purpose (photograph food for feedback) and (b) the storage posture (not kept unless opted in). If the retention behavior ever changes, this string changes in the same PR.
- [ ] **No** `NSPhotoLibraryUsageDescription` and no photo-library code path exists (capture only, per ios-client §2). An unused permission string is itself a review flag.

### 2.2 Denial handling — a review-tested path

Reviewers routinely deny the first permission prompt and check the app doesn't dead-end or crash. This is a pass/fail path, not polish.

- [ ] Permission is requested only behind the user's shutter tap, never on cold launch (ios-client §2).
- [ ] On `.denied` / `.restricted`, the shutter is replaced by the denial state: explanatory copy + "Open Settings" button via `UIApplication.openSettingsURLString`.
- [ ] Returning from Settings with permission granted recovers **without relaunch** (re-check on `scenePhase == .active`).
- [ ] Verified by hand before submission: deny → see denial state → Settings → grant → return → shutter works. No crash, no blank screen, at every step.

## 3. Privacy policy — Guideline 5.1.1(i)

### 3.1 Required contents

The policy must accurately describe the two-tier model. Minimum contents, each checkable against the settled specs:

- [ ] **What is collected, in two tiers, stated plainly:**
  - *Always:* derived data from each analyzed photo — detected food labels, portion estimate, calorie range + confidence, the selected goal, the reaction text, a timestamp — keyed to the user's account (data-model §2.1). Stated explicitly that this is kept **even when the photo is not**.
  - *Opt-in only:* the food photo itself, kept **90 days** then automatically deleted (data-model §5). Off by default; the toggle is on the camera screen.
  - *Account:* authentication identity via Clerk (Apple or Google sign-in). No email, name, or profile data is stored in our own database (data-model §4).
- [ ] **What is never collected:** photo location/EXIF (stripped on-device by construction, ios-client §3); photos the user did not opt to store are processed to produce the feedback and not retained; non-food photos store nothing at all (feedback-api §2.2).
- [ ] **Purposes:** derived data → provide the feedback and improve the product; opt-in photos → improve the model/prompts. No advertising, no sale of data, no tracking.
- [ ] **Processors/third parties, named:** Clerk (authentication), Vercel (API hosting), Neon (database), UploadThing (opt-in photo storage), and the AI model provider. ⚠️ The provider is an open question in feedback-api §6.1 — **the policy cannot ship with a blank; naming the chosen provider is a dependency of submission.**
- [ ] **Retention:** photos 90 days; derived data until account deletion.
- [ ] **Deletion rights and how:** delete your account in-app (§5.1) → everything is deleted (data-model §4); or request deletion of your data without closing the account via the support contact (§5.2), fulfilled within 30 days.
- [ ] **Contact:** a monitored email address for privacy requests.
- [ ] No claims the specs can't back. In particular the policy must not say photos are "never stored" (opt-in exists) or that data is anonymous (derived rows are keyed to a user id — data-model §2.1 calls this out as personal data).

### 3.2 Hosting and linking

- [ ] Hosted at a stable public URL (a static page on the existing Vercel deployment is sufficient — e.g. `https://<domain>/privacy`). No login wall, renders on mobile.
- [ ] URL entered in the **App Store Connect privacy policy field** (required metadata).
- [ ] Linked **inside the app** in an easily accessible place: the Auth screen footer (visible pre-consent, before any data flows) and the Account menu (§5.1). Guideline 5.1.1(i) requires in-app accessibility, not just the store listing.

## 4. Privacy nutrition label — App Store Connect declarations

Declared in App Store Connect under App Privacy. Governing decision: **the label declares the derived data, not just the opt-in photo.** Per data-model §2.1, derived rows (labels, portion, kcal range, goal, reaction, timestamp) are personal data keyed to a Clerk user id and kept indefinitely — a label that only mentioned photos would be dishonest and, worse for review, inconsistent with our own privacy policy.

- [ ] **"Data Used to Track You": none.** No ATT prompt, no tracking SDKs, no ad frameworks. (v1 has zero analytics/telemetry — ios-client §9, data-model §6. Adding any analytics SDK later reopens this section.)
- [ ] **"Data Linked to You"** — everything below is linked (keyed to the Clerk user id); nothing qualifies as "not linked":

| Apple category → type | What it actually is | Collected? | Purposes | Notes |
|---|---|---|---|---|
| Photos or Videos | The food photo | Yes | App Functionality; Analytics (product/model improvement) | Optional (opt-in toggle); retained 90 days. Declared even though opt-out photos are transient — the opt-in path stores them, and the label describes the app's practices, not one request. |
| Health & Fitness → Health | Selected goal (e.g. *lose weight*) + calorie/portion estimates | Yes | App Functionality; Analytics | The conservative, honest call: diet goals and kcal data keyed to identity are health data. Mislabeling health data is a high-severity rejection. |
| Identifiers → User ID | Clerk user id | Yes | App Functionality | Keys every row (data-model §2). |
| Contact Info → Email Address, Name | Sign-in identity held by Clerk | Yes | App Functionality | Collected by our auth processor even though our DB stores neither (data-model §4). "Collected by the developer or their processors" — Clerk is our processor, so it's declared. |
| Other Data | Reaction text, food labels, timestamp | Yes | App Functionality; Analytics | The rest of the derived record. |

- [ ] **Not declared, verifiably absent:** precise/coarse location (EXIF stripped, ios-client §3), contacts, browsing history, purchase history, diagnostics/crash data (no crash SDK in v1), search history.
- [ ] Label, privacy policy (§3), and actual server behavior all tell the same story. Discrepancy between any two is the failure mode; check all three against each other before submission.

## 5. Account deletion & data deletion — Guideline 5.1.1(v)

### 5.1 In-app account deletion (required addition to client scope)

Apps that offer account creation must let users **initiate account deletion in the app**. No settled spec provides this — v1 deliberately has no settings screen (ios-client §1). This spec therefore adds the minimum affordance:

- [ ] An **Account menu** on the Camera screen (e.g. a toolbar item), containing exactly: *Sign out*, *Delete account*, *Privacy policy* (link, per §3.2). Nothing else; this is not a settings screen and does not reopen that decision.
- [ ] *Delete account* runs a confirmation step, then deletes the Clerk user (Clerk SDK `user.delete()`; if the SDK build in use lacks it, Clerk's hosted account portal reached from this menu item satisfies "initiated in-app" — confirm against the pinned SDK version, ios-client §8.3).
- [ ] Clerk deletion fires the `user.deleted` webhook → full server-side wipe of files and rows (data-model §4). Verified end-to-end in a test environment: delete account in-app → zero `feedback` rows, zero `stored_photo` rows, zero UploadThing files for that user id.
- [ ] The deletion flow is **not** buried behind a URL the reviewer can't find, and does not require calling support or visiting an unlinked website — both are named rejection patterns.

### 5.2 Manual runbook: "delete my data, keep my account"

v1 deletes data only on Clerk account deletion. A user who wants their data gone **without** closing their account (GDPR/CCPA erasure of content, not the account) is served by a manual operational procedure, not code. This is acceptable for v1 — the right must be honorable, not automated — but it must be written down and followable by whoever staffs the support inbox:

- [ ] The runbook below is kept alongside this spec and referenced from the privacy policy's deletion section (§3.1).

**Runbook — single-user data deletion (account preserved):**

1. **Verify the requester.** Request must come from (or be confirmed via) the email on the Clerk account: look the user up in the Clerk dashboard by email, confirm the address matches the sender. Hide-My-Email relay addresses count — match the relay, not a claimed "real" address.
2. **Record the request** (date, `user_...` id, requester email) before acting.
3. **Delete, in the data-model §4 order** (file keys must be read before rows cascade away):
   ```sql
   SELECT uploadthing_key FROM stored_photo WHERE clerk_user_id = $1;
   ```
   Delete each returned file via the UploadThing API, then:
   ```sql
   DELETE FROM feedback WHERE clerk_user_id = $1;  -- FK cascade removes stored_photo rows
   ```
4. **Verify:** both of these return zero rows —
   ```sql
   SELECT count(*) FROM feedback WHERE clerk_user_id = $1;
   SELECT count(*) FROM stored_photo WHERE clerk_user_id = $1;
   ```
   — and the UploadThing dashboard shows no files for the deleted keys.
5. **Confirm to the user** by reply, noting their account remains active and future photos will create new records under the same two-tier rules.
6. **SLA: 30 days** from verified request to confirmation (comfortably inside GDPR's one month).

The sequence is idempotent (data-model §4) — a partial failure is safely re-run from step 3. Note the account itself, and whatever Clerk holds (email, sign-in identity), survives by design; full erasure is the §5.1 path.

## 6. Minimum functionality — Guideline 4.2

The risk: a reviewer sees "camera app that calls an API" and rejects as a thin wrapper. The defense is that the AI reaction *is* the product (mvp.md §"What it is") and the app demonstrates judgment, not just capture.

- [ ] The core loop works on a physical device with a real photo at submission time: sign in → goal → photo → goal-voiced reaction with calorie range. A broken model call during review is an automatic 2.1 rejection regardless of 4.2.
- [ ] The four goals produce **visibly different** reactions to the same plate (the voice blocks, feedback-api §4.3) — this is the concrete evidence the app does something beyond captioning.
- [ ] The non-food redirect works gracefully: a reviewer at a desk will photograph a keyboard or a wall first. The in-band redirect ("That's a keyboard — point me at your plate", feedback-api §2.2) turns the most likely first review interaction into a feature demo instead of an error.
- [ ] **App Review notes** (App Store Connect) written to preempt the wrapper reading, stating: the app provides AI-generated, goal-conditioned feedback on food photos; any Apple ID works via Sign in with Apple (no demo credentials needed — satisfies Guideline 2.1 for login-gated apps); photograph any food, or any object to see the non-food handling; the photo-storage toggle is off by default and the app is fully functional without it.
- [ ] Reactions contain no medical claims, diagnoses, or supplement advice (feedback-api §4.5 binds this in the system prompt) — relevant to 1.4 (physical harm) for a weight-loss-adjacent app; spot-check outputs across all four goals before submission.

## 7. Submission mechanics (one-liners, still checkable)

- [ ] `ITSAppUsesNonExemptEncryption = NO` in `Info.plist` (HTTPS-only is exempt) so review isn't blocked on export compliance.
- [ ] Age rating questionnaire answered honestly (nothing in v1 triggers a restrictive rating; "unrestricted web access" is No — there is no browser).
- [ ] Screenshots show the real core loop (goal → camera → reaction); no mocked reactions that overpromise (5.1.1 honesty extends to metadata).
- [ ] App name/subtitle/description make no health-outcome claims ("lose weight with…" is a claim; "feedback on your food for your goals" is not).

## 8. What this spec deliberately excludes

Auth-spec internals (Clerk session mechanics), the marketing copy itself, App Store screenshots/asset production, non-Apple legal work (GDPR records of processing, DPAs with processors — real, but not App Store review), and any automated in-app "delete my data, keep my account" feature (deferred; §5.2 is the v1 answer).

## 9. Done when

Every checkbox above is checked against the built app, the live privacy-policy URL, and the App Store Connect submission — by someone actually toggling, denying, deleting, and reading, not by code review. The three artifacts that must agree — the app's behavior, the privacy policy, and the nutrition label — have been cross-checked as a set. The submission is blocked on exactly one named dependency: the AI provider is chosen and named in the privacy policy (§3.1).
