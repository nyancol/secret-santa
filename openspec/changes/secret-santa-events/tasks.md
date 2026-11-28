# Tasks

## 1. Data model (migration v2)

- [x] 1.1 Add additive migration v2 (`events`, `event_participants`, `event_exclusions`, `event_assignments`, `participant_profiles`, `wishlist_items` with FKs, unique indexes, self-exclusion CHECK) to `src/db/index.ts` + drizzle models in `src/db/schema.ts`, and verify `npm test` existing suites still pass with a fresh DB.
- [x] 1.2 Add `requireMember` / `requireOrganiser` helpers + event-status guard, and verify with unit tests that outsiders get 403 and locked events get 409.

## 2. Event lifecycle API (`santa-events`)

- [x] 2.0 Implement `GET /api/v1/users?search=` (authenticated-only, id + displayName only, substring match, limit 50) for the invite picker, and verify via route tests (200 match, 200 empty→recent, 401 anon, no `sub`/email leaked).

- [x] 2.1 Implement `POST /api/v1/events` (budget required, organiser auto-joins) + `PATCH /api/v1/events/:id` + `GET /api/v1/events/:id` + `GET /api/v1/events` (my events with `role` organiser/member, organiser/member-only reads, draft-only edits) with Fastify JSON-schema validation, and verify via route tests (201 create, 200 edit, 200 list with roles, 401 anon, 403 non-organiser, 409 locked, 422 bad dates, 422 missing budget).
- [x] 2.2 Implement participant invite/remove (`POST/DELETE /api/v1/events/:id/participants`, draft-only, 404 unknown user) and verify via route tests including roster-locked-after-draw (409).
- [x] 2.3 Implement exclusion CRUD (`POST/DELETE /api/v1/events/:id/exclusions`, distinct-participants validation, `mutual: true` default creating both directions) and verify via route tests (201 mutual + directed, 422 non-participant/self, 403 non-organiser).

## 3. Draw + private reveal (`santa-events`)

- [x] 3.1 Implement draw solver (seeded-RNG backtracking derangement respecting exclusions, `draw_impossible` detection) as a pure unit with injectable RNG, and verify with unit tests (derangement property, exclusion respect, impossible set → error, determinism under seed).
- [x] 3.2 Implement `POST /api/v1/events/:id/draw` (single transaction, `draft→drawn` guarded update, 403/409/422 paths) + `GET .../my-giftee` (own giftee only, 404 pre-draw), and verify via route tests including concurrent double-draw → one 200 + one 409 and directory responses containing no assignment fields.

## 4. Profiles + wishlist + directory (`santa-profiles`)

- [x] 4.1 Implement `PUT /api/v1/events/:id/profile` (owner-only upsert, member-only) and verify via route tests (200 own, 403 cross-user/outsider).
- [x] 4.2 Implement wishlist CRUD (`POST/GET/PATCH /:itemId/DELETE /api/v1/events/:id/wishlist`, owner-only writes, position ordering) and verify via route tests (201/200, 403 cross-user).
- [x] 4.3 Implement `GET /api/v1/events/:id/participants` directory (profiles + wishlists, no assignment fields, member-only) and verify via route tests (200 member with full payload, 403 outsider, 401 anon).

## 5. Integration + contract

- [x] 5.1 Extend OpenAPI (`/api/v1/openapi.json`) + error-shape docs for the new routes (including `GET /api/v1/users` and `GET /api/v1/events`), and verify `GET /api/v1/openapi.json` lists all new paths in a contract test.
- [x] 5.2 Run full gate (`mise run check`: typecheck + lint + format:check + `npm test` with coverage) and verify green; add OTEL span around draw without logging assignment edges.
