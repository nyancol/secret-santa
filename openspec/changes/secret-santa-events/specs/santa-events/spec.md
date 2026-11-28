# Spec Delta

## Purpose

Event lifecycle for Secret Santa: organisers create events, manage rosters and
exclusion rules, and trigger a constrained random draw whose assignments stay
private per participant.

## ADDED Requirements

### Requirement: Create event
The system SHALL let any authenticated user create an event with `name`
(required), `description`, `signupDeadline`, `drawDate`, `giftDate`,
`budgetAmount` (required, price limit, > 0) + `budgetCurrency` (required),
and record the creator as organiser. The creator is auto-added as a
participant on create.

#### Scenario: Event created with organiser
- **WHEN** an authenticated user POSTs `/api/v1/events` with a valid name and dates
- **THEN** the response is 201 with the event including `status: "draft"` and `organiserId` equal to the caller.

#### Scenario: Organiser auto-joins roster
- **WHEN** an event is created
- **THEN** the organiser appears in the roster as a participant without a separate invite.

#### Scenario: Missing price limit rejected
- **WHEN** the payload omits `budgetAmount` or `budgetCurrency`
- **THEN** the response is 422 and no event is created.

#### Scenario: Unauthenticated create rejected
- **WHEN** a client without a session POSTs `/api/v1/events`
- **THEN** the response is 401 `{ error: "unauthorized" }`.

#### Scenario: Invalid dates rejected
- **WHEN** the payload has `drawDate` after `giftDate` or unparseable dates
- **THEN** the response is 422 with a validation error and no event is created.

### Requirement: Update draft event
The system SHALL let only the organiser update a `draft` event's details
(name, description, dates, budget); updates to non-draft events SHALL be rejected.

#### Scenario: Organiser edits draft
- **WHEN** the organiser PATCHes `/api/v1/events/:id` while status is `draft`
- **THEN** the response is 200 with the updated event.

#### Scenario: Non-organiser edit forbidden
- **WHEN** a non-organiser PATCHes the event
- **THEN** the response is 403 `{ error: "forbidden" }`.

#### Scenario: Edit after draw rejected
- **WHEN** the organiser PATCHes an event with status `drawn`
- **THEN** the response is 409 `{ error: "event_locked" }`.

### Requirement: Invite and remove participants
The system SHALL let only the organiser add participants (existing users by id)
and remove them while the event is `draft`; roster changes after the draw
SHALL be rejected.

#### Scenario: Invite participant
- **WHEN** the organiser POSTs `/api/v1/events/:id/participants` with an existing user id
- **THEN** the response is 201 and the user appears in the roster.

#### Scenario: Invite unknown user rejected
- **WHEN** the organiser invites a user id that does not exist
- **THEN** the response is 404 and the roster is unchanged.

#### Scenario: Roster locked after draw
- **WHEN** anyone POSTs or DELETEs a participant on a `drawn` event
- **THEN** the response is 409 `{ error: "event_locked" }`.

### Requirement: Exclusion list
The system SHALL let only the organiser define exclusion pairs
(`giverId` cannot gift `recipientId`); both ids MUST be current participants
and self-exclusions SHALL be rejected. By default exclusions are mutual
(`mutual: true` creates both directions); `mutual: false` creates a single
directed pair.

#### Scenario: Add mutual exclusion by default
- **WHEN** the organiser POSTs `/api/v1/events/:id/exclusions` with two distinct participant ids and no `mutual` flag
- **THEN** the response is 201 with both directions stored.

#### Scenario: Add directed exclusion
- **WHEN** the organiser POSTs with `mutual: false`
- **THEN** only the requested direction is stored.

#### Scenario: Delete exclusion removes both directions by default
- **WHEN** the organiser DELETEs `/api/v1/events/:id/exclusions` with two participant ids and no `mutual` flag
- **THEN** both directions are removed; with `mutual: false` only the requested direction is removed. By "delete" we mean removing the stored exclusion pair(s) so the draw may pair those users again.

#### Scenario: Exclusion for non-participant rejected
- **WHEN** either id is not on the roster
- **THEN** the response is 422 and nothing is stored.

#### Scenario: Non-organiser exclusion forbidden
- **WHEN** a non-organiser POSTs an exclusion
- **THEN** the response is 403.

### Requirement: Trigger constrained random draw
The system SHALL, on organiser `POST /api/v1/events/:id/draw` for a `draft`
event with >= 2 participants, compute a random derangement (nobody gifts
themselves) respecting all exclusion pairs, persist one assignment per giver,
and flip status to `drawn`. Unsatisfiable exclusion sets SHALL fail with 422
and leave the event in `draft`.

#### Scenario: Successful draw
- **WHEN** the organiser triggers the draw on a valid draft event
- **THEN** the response is 200, status becomes `drawn`, and every participant has exactly one giftee and is giftee of exactly one giver.

#### Scenario: Draw respects exclusions
- **WHEN** the draw completes with exclusion pairs defined
- **THEN** no assignment matches an excluded pair and no giver is assigned themselves.

#### Scenario: Impossible draw rejected
- **WHEN** exclusions make a valid derangement impossible
- **THEN** the response is 422 `{ error: "draw_impossible" }` and status stays `draft`.

#### Scenario: Non-organiser draw forbidden
- **WHEN** a non-organiser triggers the draw
- **THEN** the response is 403.

#### Scenario: Double draw rejected
- **WHEN** the draw is triggered on an already `drawn` event
- **THEN** the response is 409 `{ error: "already_drawn" }`.

### Requirement: Per-user giftee reveal
The system SHALL expose `GET /api/v1/events/:id/my-giftee` returning only the
caller's own giftee (after the draw); no endpoint SHALL list all assignments,
including for the organiser (organiser is blind), and pre-draw access SHALL
return 404.

#### Scenario: Participant sees own giftee
- **WHEN** a participant calls `my-giftee` on a `drawn` event
- **THEN** the response is 200 with only their giftee's id, display name, and event id.

#### Scenario: Organiser is blind
- **WHEN** the organiser calls `my-giftee`
- **THEN** the response is 200 with only the organiser's own giftee (if participating), never the full assignment list, and no other endpoint exposes assignments.

#### Scenario: Pre-draw giftee hidden
- **WHEN** a participant calls `my-giftee` while status is `draft`
- **THEN** the response is 404 `{ error: "not_drawn" }`.

#### Scenario: Outsider cannot reveal
- **WHEN** a non-participant (or non-organiser outsider) calls `my-giftee`
- **THEN** the response is 403.

### Requirement: User directory for invites
The system SHALL expose `GET /api/v1/users?search=` listing users who have
logged in at least once (local `users` table) with `id` + `displayName` only;
authenticated users only, case-insensitive substring match on `displayName`,
empty search returns recent users, capped at 50.

#### Scenario: Search logged-in users
- **WHEN** an authenticated user GETs `/api/v1/users?search=ali`
- **THEN** the response is 200 with matching users (no `sub`, no emails).

#### Scenario: Unauthenticated directory blocked
- **WHEN** a client without a session GETs `/api/v1/users`
- **THEN** the response is 401.

### Requirement: Event visibility
The system SHALL return event details and roster only to the organiser and
participants; outsiders SHALL receive 403, and unauthenticated callers 401.
The system SHALL expose `GET /api/v1/events` listing all events where the
caller is organiser or participant, each with `role: "organiser" | "member"`
and `status`; unauthenticated callers get 401.

#### Scenario: Outsider blocked
- **WHEN** an authenticated non-member GETs `/api/v1/events/:id`
- **THEN** the response is 403.

#### Scenario: List my events
- **WHEN** an authenticated user GETs `/api/v1/events`
- **THEN** the response is 200 with all events where they are organiser or participant (empty array if none).
