# Spec: Feedback API + AI Contract

**Status:** Settled (v1)
**Derived from:** `specs/mvp.md` (locked)
**Last updated:** 2026-07-02
**Owner:** Hien Nguyen

Defines the binding contract for the one server call in the MVP core loop: photo + goal in, reaction out. Covers the HTTP contract, error/edge states, and the AI layer (prompting and structured output). **Not covered here:** data-model tables (separate spec), screens, auth flows beyond what the route requires, photo retention mechanics.

---

## 1. Flow overview

```
iOS client ──(multipart: image bytes + goal + opt-in)──▶ POST /api/feedback (Vercel route)
                                                              │
                                                              ├─▶ Vision model (single call, structured output)
                                                              ├─▶ Derived-data write (always; tables in data-model spec)
                                                              ├─▶ UploadThing upload (ONLY if opt-in AND is_food)
                                                              ▼
iOS client ◀──(JSON: reaction + derived fields)───────── 200
```

Decisions locked in discussion (2026-07-02):

1. **Image bytes go to the route**, not to UploadThing first. Opted-out photos never touch third-party storage — this is what makes the two-tier privacy story real. Client compresses to JPEG ≤ 2 MB (Vercel body limit is ~4.5 MB; server hard-rejects > 4 MB).
2. **Non-food photos are an in-band 200**, not an error. The model can nearly always say something graceful; errors are reserved for transport and model failures.
3. **No calorie or portion numbers.** The reaction names *what* the food is and reacts to it; numeric estimates from a single photo are false precision and stray into health-claim risk, so they are out of scope for v1. The model may reference portion or richness qualitatively *in the reaction prose* ("that's a big plate"), but there is no structured calorie/portion/confidence field.

## 2. Endpoint: `POST /api/feedback`

- **Runtime:** Vercel API route (Node), `maxDuration: 30`.
- **Auth:** `Authorization: Bearer <Clerk session JWT>`. Verified server-side; the Clerk user id keys the derived-data write. No JWT → `401`.
- **Content type:** `multipart/form-data`.

### 2.1 Request

| Field | Type | Required | Rules |
|---|---|---|---|
| `image` | file (JPEG) | yes | Client-compressed to ≤ 2 MB, longest edge ≤ 1568 px. Server rejects non-JPEG/HEIC-undecodable or > 4 MB. |
| `goal` | string enum | yes | `lose_weight` \| `less_sugar` \| `build_muscle` \| `eat_mindfully` |
| `store_photo` | boolean | yes | The opt-in flag, sent explicitly on every request (no server-side default — the client owns the toggle state). |

### 2.2 Response — `200 OK`

```jsonc
{
  "id": "fb_01J...",              // server id of the derived record (record shape in data-model spec)
  "is_food": true,
  "reaction": "Solid protein on that plate — the fries are doing most of the heavy lifting, though.",
  "what_this_is": "Grilled chicken with fries and a side salad",
  "labels": ["grilled chicken", "french fries", "side salad"],
  "photo_stored": false            // true only if store_photo was true AND upload succeeded
}
```

Field rules the client may rely on:

- `reaction`: always present, 1–3 sentences, ≤ 280 chars, voiced per goal (§4).
- `what_this_is`: always present when `is_food` is true; one line, no trailing period style opinions — plain description.
- `labels`: 1–6 lowercase food names when `is_food` is true; `[]` otherwise.
- The response contains **everything the server derived and stored** — the client never needs a follow-up fetch, and the user sees exactly what was kept.

**Non-food variant** (`is_food: false`): `reaction` is a graceful redirect ("That's a keyboard — point me at your plate"), `what_this_is` describes what it saw, `labels` is `[]`, no derived record is stored, no photo is uploaded regardless of opt-in, and `id` is `null`.

### 2.3 Errors

Envelope for all non-200s:

```json
{ "error": { "code": "model_failure", "message": "The AI couldn't process this photo.", "retryable": true } }
```

| HTTP | `code` | Cause | `retryable` | Client behavior |
|---|---|---|---|---|
| 400 | `invalid_image` | Undecodable / not an image | no | "Try another photo" |
| 400 | `invalid_goal` | Enum mismatch | no | Client bug; log |
| 401 | `unauthorized` | Missing/expired JWT | no | Refresh Clerk session, retry once |
| 413 | `image_too_large` | > 4 MB after client compression | no | Recompress and retry (client bug if hit) |
| 502 | `model_failure` | Provider error, or output failed schema validation after one repair retry (§4.4) | yes | "Something went wrong — try again" |
| 504 | `timeout` | Model call exceeded budget (§3) | yes | Same as above |
| 429 | `rate_limited` | Per-user throttle (limit TBD, open question §6) | yes | Back off, show cooldown |

`message` is safe to show verbatim. Invalid schema output is never forwarded to the client — a malformed model response is a `model_failure`, full stop.

## 3. Time budget

Synchronous single call; no polling or webhooks in v1.

| Stage | Budget |
|---|---|
| Model call (server-imposed deadline) | 20 s |
| Route total (`maxDuration`) | 30 s |
| Client timeout | 35 s |

UploadThing upload (when opted in) happens **after** the model call succeeds and **must not fail the request**: if the upload errors, the route still returns 200 with `photo_stored: false` and logs the failure. The reaction is the product; storage is best-effort.

## 4. AI layer

### 4.1 Model & call shape

One vision-capable model call per request, behind a thin provider adapter (`generateFeedback(imageBytes, goal): ModelOutput`) so the provider can be swapped without touching the route. **Default provider: Anthropic Claude Sonnet 5 (`claude-sonnet-5`)** — chosen for instruction-following and tone quality, since the goal-voiced reaction is the product; latency sits inside the 20 s budget, and the Anthropic API does not train on inputs by default (relevant to the opt-in photo path). The adapter keeps this swappable (e.g. A/B a cheaper tier like Haiku for cost) without touching the route. The contract below remains provider-agnostic.

Structured output is **schema-enforced** — with Claude this is **tool-use mode** (a single tool whose input schema is the §4.2 object), never "please return JSON" prose.

### 4.2 Model output schema

The model must return exactly this object; it is a superset feeding both the API response and the derived-data write:

```jsonc
{
  "is_food": true,
  "what_this_is": "string, one line",
  "labels": ["1–6 lowercase food names; [] if not food"],
  "reaction": "string, 1–3 sentences, <= 280 chars, in the goal's voice"
}
```

### 4.3 Prompt architecture: one system prompt + four voice blocks

A single shared system prompt carries the role ("you react to a photo of food against the user's goal"), the output contract, and the safety rules (§4.5). The selected goal injects one **voice block** — data, not code; four variants in one config file:

| Goal | Persona & focus | Tone rules | Reaction leans on |
|---|---|---|---|
| `lose_weight` | Pragmatic coach; calorie density and portion size | Direct but never shaming; comment on the plate, not the person | "That's a big portion of a dense dish" energy |
| `less_sugar` | Sugar-spotter; desserts, sodas, dressings, hidden sugar | Matter-of-fact reveals; celebrate low-sugar picks | Names where the sugar hides |
| `build_muscle` | Training-partner; protein presence first | Upbeat; nudges when protein is missing, cheers when it's there | "Where's the protein?" / "Good protein anchor" |
| `eat_mindfully` | Gentle noticer; prompts a pause | Softest voice; no numbers-first framing, notices color/texture/care | Invites attention, never judges |

Renaming or adding a goal = adding a voice block + enum value; no other change (per MVP: goals extend without touching architecture).

### 4.4 Validation & repair

Server validates model output against the schema (including cross-field rules: `labels` non-empty iff `is_food` true; `what_this_is` present iff `is_food` true). On failure: **one** repair retry (re-prompt with the validation error appended). Second failure → `502 model_failure`. The client never receives unvalidated model output.

### 4.5 Safety & tone rules (in the shared system prompt)

- React to the food, never to the user's body or worth. No shame, no moralizing ("bad food", "cheating").
- No medical claims, diagnoses, or supplement advice.
- No numeric daily targets or deficit math — v1 is stateless and must not pretend to know the user's day.
- Uncertainty is stated plainly ("hard to tell the portion from this angle") rather than papered over.

### 4.6 Edge cases (model-level, all in-band 200s)

| Case | Contract |
|---|---|
| Blurry / dark but plausibly food | `is_food: true`, reaction acknowledges the poor image and may ask for a better shot |
| Multiple dishes in frame | Labels list them; reaction addresses the plate as a whole, anchored on the goal-relevant item |
| Packaged food, menus, drinks | Count as food (`is_food: true`) if it's an edible/drinkable product; menus are `is_food: false` with a redirect |
| Empty plate / wrappers | `is_food: false`, graceful redirect |

## 5. What this spec deliberately excludes

Data-model tables (derived-record and photo-reference shapes → data-model spec), photo retention window mechanics (30–90 days, → privacy/data spec), Clerk integration details (→ auth spec), and client UI states.

## 6. Open questions

1. ~~**Default model/provider** for the adapter.~~ **Resolved: Anthropic Claude Sonnet 5** (§4.1). A quick eval on real food photos (label accuracy, reaction/voice quality, latency under the 20 s budget) is still worth running to confirm before launch, and to baseline a cheaper tier for later.
2. **Rate limit** value for `429` (protects the model bill; propose per-user 20/hour to start).
3. Whether HEIC is transcoded client-side (recommended) or accepted server-side.

## 7. Done when

The route accepts the request shape in §2.1, returns the response in §2.2 for real food photos across all four goals with schema-valid output, exercises every error code in §2.3 under test, and never uploads an opted-out photo to UploadThing.
