# Design

## Context

See proposal.md (Why). Current state: Fastify 5 + TypeScript + better-sqlite3
via drizzle, additive-only `MIGRATIONS` chain in `src/db/index.ts`
(`__migrations`-tracked; rollback = `git revert` replay). Session auth:
`onRequest` guard in `src/app.ts` requires session cookie for all
`/api/v1/*`; organiser checks are per-route on top. Users table holds
`id/sub/displayName`. No domain tables yet. Same-origin SPA, CSRF
Origin/Referer check on state-changing `/api/*`, no CORS.

## Goals / Non-Goals

**Goals:**
- Event + roster + exclusion + one-shot draw + per-user reveal under `/api/v1/*`.
- Per-event shipping profile + wishlist with owner-only writes, member-wide reads.
- Draw that is uniformly random over valid derangements (or clearly documented
  approximation) and testable/deterministic under a seed in tests.

**Non-Goals:**
- Re-draw / undo draw, waitlist, multi-giftee rings, email/push notifications
  (giftee is revealed in-app via `my-giftee`).
- Real-time updates, pagination (rosters are friend-group sized), file uploads
  for wishlist images (URL links only).

## Decisions

### 1. Tables: `events`, `event_participants`, `event_exclusions`, `event_assignments`, `participant_profiles`, `wishlist_items`
One additive migration (v2). `events(id, name, description, signup_deadline,
draw_date, gift_date, budget_amount, budget_currency, organiser_id FK users,
status draft|drawn, created_at, updated_at)`. Participants: composite PK
`(event_id, user_id)`. Exclusions: `(event_id, giver_id, recipient_id)` with
`CHECK (giver_id != recipient_id)` + FKs to participants (so removing a
participant cascades their edges). Assignments: `(event_id, giver_id UNIQUE,
recipient_id)` — giver unique, recipient unique per event (enforced in SQL
with unique indexes). Profiles: `(event_id, user_id)` one row, upsert on PUT.
Wishlist: `(id, event_id, user_id, label, url, price_hint, priority,
position)`; FK to participants with cascade.
Alternative considered: JSON columns for wishlist/exclusions — rejected:
loses FK integrity and per-row auth checks.

### 2. Draw algorithm: backtracking sampler with retry cap, seeded RNG injectable
`POST .../draw` runs in a single SQLite transaction: lock check
(`status=draft`), load roster + exclusions, then sample. Approach: random
Fisher–Yates derangement attempts filtered by exclusion set, up to N=1000
tries; fall back to deterministic backtracking solver with randomized peer
order to guarantee finding a solution when one exists. RNG injected
(`crypto.randomInt` in prod, seeded PRNG in tests) so tests assert uniformity
shape, not exact output. Failure (no solution within cap, or solver proves
unsatisfiable for small n) → 422 `draw_impossible`, transaction rolled back,
status stays `draft`.
Alternative considered: Hungarian/permutation enumeration — overkill for
friend-group n; backtracking is O(n!) worst case but n < ~50 is trivial, and
the cap keeps latency bounded.

### 3. Privacy by construction: no bulk-assignment read path
Only two assignment-touching queries exist: `INSERT` at draw time and
`SELECT ... WHERE giver_id = ?` for `my-giftee`. The participant-directory
query joins users + profiles + wishlist only — never the assignments table —
so leaks are impossible at the query layer, not just the serializer.
`GET /events/:id` (organiser view) also omits assignments; organiser learns
nothing about who-gifts-whom after the draw.

### 4. AuthZ layering: guard + per-route checks
Keep the existing `onRequest` session gate untouched. Add small helpers
`requireOrganiser(eventId, userId)` → 403 and `requireMember(eventId, userId)`
→ 403, applied in each route. Status lock (`draft` vs `drawn`) checked inside
the route/transaction → 409 `event_locked` / `already_drawn`. Validation via
Fastify JSON-schema on routes (422 on bad dates/unknown user/positions).

### 5. Status transitions: `draft → drawn` only, one-shot
No `cancelled`/`reopen` states in v1 (keeps the state machine to one edge and
avoids assignment-invalidation semantics). Re-draw is explicitly out; a future
change can add `drawn → draft` reset that deletes assignments.

## Risks / Trade-offs

- [Unsatisfiable exclusions frustrate organiser] → Mitigation: 422 includes
  `conflicting` hint (smallest violating subset when cheap to compute);
  frontend shows roster/exclusion editor before retry.
- [Draw perceived as rigged] → Mitigation: uniform sampling over valid
  derangements; log draw `event_id`, timestamp, participant count (never edges)
  to OTEL span for auditability.
- [Concurrent double-draw] → Mitigation: single SQLite write transaction with
  `UPDATE events SET status='drawn' WHERE id=? AND status='draft'` guard; loser
  gets 409.
- [Address PII visible to all members] → Accepted trade-off per request
  (friends group); note in API docs; reassess with a per-field visibility flag
  if groups grow beyond friends.

## Migration Plan

1. Land migration v2 (additive tables + indexes) — replay-safe with existing
   `__migrations` chain.
2. Register `src/events/*` + `src/profiles/*` routes in `app.ts`; extend
   OpenAPI snapshot.
3. Add vitest suites (event CRUD, roster/exclusion authZ, draw solver incl.
   impossible case, privacy: directory has no assignment fields).
4. Rollback: `git revert` — v2 migration is additive; revert redeploys without
   the routes while tables sit unused (consistent with `auth` spec's
   additive-only rule).

## Open Questions

- None blocking. Minor: budget currency free-text vs ISO-4217 enum — default
  to free-text `budgetCurrency` with frontend datalist; tighten later without
  spec change.
