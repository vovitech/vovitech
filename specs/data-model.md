# Spec: Data Model (MVP)

**Status:** Settled (v1)
**Derived from:** `specs/mvp.md` (locked), `specs/feedback-api.md` (settled)
**Last updated:** 2026-07-02
**Owner:** Hien Nguyen

Defines the persistence layer for the MVP loop: the derived-data record written on every food photo, the photo-reference record written only on opt-in, how they relate, the Clerk tie-in, and photo retention mechanics. **Not covered here:** the HTTP contract (feedback-api spec), auth flows, client UI.

Decisions locked in discussion (2026-07-02):

1. **Neon Postgres + Drizzle.**
2. **Photo retention: 90 days**, stamped per-row at write time.
3. **User deletion is triggered by Clerk's `user.deleted` webhook.**
4. **Opt-out means no photo row exists at all** — enforced by write order, not by nullable columns or status flags.

---

## 1. Database choice: Neon Postgres

Neon (via the Vercel Marketplace) with the Drizzle ORM, using Neon's serverless driver from the API route.

Why: it is the first-party Postgres for Vercel deployments; the model is genuinely relational (two tables, a real foreign key, a cascade); the deletion and retention stories reduce to plain SQL; and the project's coding standards already mandate a type-safe ORM (Drizzle/Prisma). Key-value or edge-SQLite alternatives (Upstash, Turso) offer nothing this workload needs and would weaken the FK/cascade deletion guarantees.

Schema migrations via `drizzle-kit`. One database per environment (dev/prod).

## 2. Tables

Two tables. That is the entire v1 schema.

### 2.1 `feedback` — derived-data record

One row per **successful food analysis**. Written on every request where the model returns `is_food: true` and validation passes. Non-food photos write nothing (per API spec §2.2 — the response carries `id: null`). This table is what "always kept (low-risk)" in the MVP spec refers to — and it is still **personal data**: rows are keyed to a Clerk user id and must be findable and deletable per user (§4).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `text` | PK | `fb_` + ULID, generated server-side; the same id returned in the API response |
| `clerk_user_id` | `text` | NOT NULL | Clerk's `user_...` string (§4) |
| `goal` | `goal` enum | NOT NULL | §3 |
| `what_this_is` | `text` | NOT NULL | One-line description from the model |
| `labels` | `jsonb` | NOT NULL | Array of 1–6 lowercase food-name strings |
| `portion` | `text` | NOT NULL | Human-readable portion estimate |
| `kcal_min` | `integer` | NOT NULL | |
| `kcal_max` | `integer` | NOT NULL, CHECK `kcal_max >= kcal_min` | Mirrors the API's cross-field rule |
| `confidence` | `confidence` enum | NOT NULL | `low` \| `medium` \| `high` |
| `reaction` | `text` | NOT NULL | The reaction text as shown to the user |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | The API's timestamp |

`portion`, `kcal_min`, `kcal_max` are NOT NULL deliberately: the API spec's validation rules allow nulls only when `is_food` is false, and non-food results never produce a row. If the model can't estimate, it still returns a wide range at `confidence: "low"` — the schema does not admit "food but no estimate."

**Index:** `(clerk_user_id, created_at)` — serves per-user deletion (§4) now and history views (deferred, not rejected in the MVP) later without a migration.

### 2.2 `stored_photo` — photo reference

One row **only when** the request had `store_photo: true` **and** the UploadThing upload succeeded. The raw image lives in UploadThing; this row is the reference and the retention handle.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `text` | PK | `ph_` + ULID |
| `feedback_id` | `text` | NOT NULL, UNIQUE, FK → `feedback(id)` ON DELETE CASCADE | Enforces 1 → 0..1 |
| `clerk_user_id` | `text` | NOT NULL | Denormalized copy so photo lookup/deletion never needs a join |
| `uploadthing_key` | `text` | NOT NULL | UploadThing file key — the handle used to delete the file |
| `expires_at` | `timestamptz` | NOT NULL | `created_at` + retention window (§5) |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Index:** `expires_at` (for the reaper, §5); `clerk_user_id` (for user deletion, §4).

### 2.3 Relation and write order

`feedback` 1 → 0..1 `stored_photo`. The route writes in this order:

1. Model call succeeds and validates → **insert `feedback`** (its id goes in the response).
2. If `store_photo` is true → attempt the UploadThing upload.
3. Upload succeeded → **insert `stored_photo`**. Upload failed or opt-out → **no insert**; response carries `photo_stored: false` (per API spec §3, upload failure never fails the request).

This ordering is the opt-out guarantee: there is no nullable URL column, no "pending" status, no row to clean up. A `stored_photo` row exists only if a real file exists in UploadThing.

The converse is **not** guaranteed by ordering alone. Two crash windows exist, and only one is self-healing:

- **Row without file** (crash after a delete removes the file but before the row is deleted): harmless and self-healing — the reaper/webhook find the row on the next run and re-delete (idempotent, §4/§5).
- **File without row** (crash after the upload succeeds but before the `stored_photo` insert): a real orphan. The file has no row, therefore no `expires_at`, so the reaper's `expires_at` query would never see it and it would live forever — defeating the retention promise. This is closed by §5's reconciliation sweep, which does not depend on a DB row existing.

To make that sweep possible, the upload uses a **deterministic UploadThing key derived from `feedback_id`** (e.g. `ph_<feedback_id>`), so an orphaned file can be matched back to its (missing) row without a stored handle.

## 3. Goal enum

A native Postgres enum, values identical to the API's wire enum:

```sql
CREATE TYPE goal AS ENUM ('lose_weight', 'less_sugar', 'build_muscle', 'eat_mindfully');
```

Adding a goal later = `ALTER TYPE goal ADD VALUE ...` + a voice block + the API enum — consistent with the MVP's promise that goals extend without architectural change. The DB enum and the API enum are the same list by definition; the route validates against the API enum before any write, so `invalid_goal` can never reach the database.

`confidence` is likewise a native enum (`low`, `medium`, `high`).

## 4. Clerk tie-in and user deletion

**No local `users` table in v1.** Clerk is the system of record for identity; we persist only the Clerk user id string (`user_...`) on both tables. The route obtains it from the verified session JWT (API spec §2) — it is never client-supplied. Nothing else about the user (email, name, chosen goal) is stored server-side in v1; the goal arrives per-request.

**Deletion trigger:** a Vercel route handles Clerk's `user.deleted` webhook (Svix signature verified). On receipt, for the deleted user id:

1. `SELECT uploadthing_key FROM stored_photo WHERE clerk_user_id = $1`
2. Delete those files via the UploadThing API.
3. `DELETE FROM feedback WHERE clerk_user_id = $1` — the FK cascade removes the `stored_photo` rows.

Step order matters: file keys must be read before the rows holding them are cascaded away. If step 2 partially fails, the webhook handler returns non-2xx so Svix retries the delivery; the sequence is idempotent (re-deleting a missing file / zero rows is a no-op).

This satisfies the API spec's requirement that derived data is treated as personal data even when no photo was stored: the `(clerk_user_id, created_at)` index makes "find everything for user X" one indexed query, and one statement deletes it.

## 5. Retention: 90 days, cron-enforced

**Window:** 90 days (upper end of the MVP's 30–90 range, chosen to maximize model-improvement material per opted-in photo). Held as a single config constant (`PHOTO_RETENTION_DAYS = 90`); `expires_at` is stamped at insert time, so a future change to the constant affects only new photos — already-stored photos keep the promise they were stored under.

**What expires:** the raw image in UploadThing and its `stored_photo` row.
**What survives:** the `feedback` row, indefinitely — until account deletion (§4). Expiry never touches derived data.

**Enforcement — daily reaper (Vercel Cron):**

1. `SELECT id, uploadthing_key FROM stored_photo WHERE expires_at < now()` (batched).
2. Delete each file via the UploadThing API.
3. Delete the corresponding rows.

File-first, row-second: if the job crashes between steps, what remains is a row pointing at a deleted file — found and retried on the next run. The reverse order would leave unreferenced files in UploadThing with no handle to find them. UploadThing deletes are idempotent for this purpose (deleting an already-deleted key is treated as success).

Cron granularity of one day is acceptable slop on a 90-day promise; no read path serves stored photos in v1, so read-time expiry checks are unnecessary.

**Orphan reconciliation (closes the file-without-row window from §2.3):** the same daily job also lists UploadThing files and deletes any whose deterministic key (`ph_<feedback_id>`) has **no** matching `stored_photo` row **and** whose UploadThing-reported upload time is older than a short grace period (e.g. 1 hour, comfortably beyond the 30 s route budget so an in-flight request is never reaped). This is the only mechanism that can find a file whose row was never written; without the deterministic key it would be unfindable. Deletes remain idempotent.

## 6. What this spec deliberately excludes

Analytics/telemetry storage (none in v1 beyond `feedback` itself), a local users/preferences table (deferred until something needs it), photo access paths (no v1 feature reads stored photos back), and rate-limit bookkeeping (the API spec's open question; if it lands as Upstash or in-Postgres counters, it is an additive change).

## 7. Done when

Drizzle schema and migrations exist for both tables with the constraints above; the feedback route performs the §2.3 write order (verified by tests: opt-out and failed-upload cases produce zero `stored_photo` rows); the Clerk `user.deleted` webhook removes all of a user's rows and files; the daily reaper deletes expired photos file-first; and a `feedback` row's data can be produced for and deleted by a single `clerk_user_id` query.
