# Proposal

## Why

A group of friends needs a simple Secret Santa service: one organiser creates an
event, invites friends, and triggers a fair random draw that respects
who-cannot-gift-whom exclusions. Each participant must only ever learn their
own giftee while still seeing everyone's wishlist and shipping details. The
current backend is a hello-world API with OIDC session auth only — no domain
logic exists yet, so this change introduces the core product.

## What Changes

- Organiser creates a Secret Santa event (`name`, `description`, `signupDeadline`,
  `drawDate`, `giftDate`, `budgetAmount` + `budgetCurrency`, organiser = creator).
- Organiser invites participants (existing users by id) and manages the roster
  while the event is in `draft` (add/remove, set/unset exclusion pairs
  `giverId cannot-gift recipientId`).
- Organiser triggers the draw (`POST .../draw`); the system computes a single
  random derangement (no self-gifts) respecting all exclusions, persists one
  assignment row per giver, and flips the event to `drawn`. Draw is one-shot
  (no re-draw in v1).
- Per-user assignment visibility: `GET .../my-giftee` returns only the caller's
  own giftee; no endpoint lists all assignments.
- Participant profiles: each user sets their own shipping/address info and
  wishlist items per event; participants can view every participant's public
  profile (display name, address as appropriate, wishlist) but never other
  users' assignments.
- All domain routes live under `/api/v1/*` behind the existing session-cookie
  gate; organiser-only actions return 403 for non-organisers; non-participants
  get 403/404 on event-scoped reads. Invite picker is backed by
  `GET /api/v1/users?search=` over locally provisioned users (OIDC first-login
  creates the row; no PocketID admin API in v1).

## Capabilities

### New Capabilities

- `santa-events`: event lifecycle — create/update draft event, invite/remove
  participants, manage exclusion pairs, trigger the constrained random draw,
  and per-user giftee reveal.
- `santa-profiles`: participant customization and visibility — own
  address/shipping info + wishlist CRUD, and participant directory
  (profiles + wishlists + addresses) visible to event members.

### Modified Capabilities

- None. `auth` (OIDC session gate) and `hello-world` (root/health/telemetry)
  requirements are unchanged; this change builds on the existing session gate.

## Impact

- Code: new `src/events/*` + `src/profiles/*` route modules, new SQLite
  migrations (additive-only per `auth` spec: `events`, `event_participants`,
  `event_exclusions`, `event_assignments`, `participant_profiles`,
  `wishlist_items`), OpenAPI additions under `/api/v1/*`.
- APIs: new REST surface (`/api/v1/events`, `/api/v1/events/:id/...`);
  no changes to `/`, `/api/health`, `/api/auth/*`.
- Frontend/API implications: SPA needs event create/invite/exclusion/draw UI,
  wishlist + address forms, participant directory, and a "my giftee" view.
  Auth stays OIDC session cookie (same-origin, CSRF rules unchanged).
- Telemetry/ops: span draw computation; no new infra. SQLite backup runbook
  unchanged (new tables ride the existing nightly snapshot).
