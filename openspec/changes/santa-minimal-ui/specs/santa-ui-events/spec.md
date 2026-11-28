# Spec Delta

## Purpose

Lets organisers create events, build the roster, configure exclusions, run the draw, and lets every participant discover only their own giftee.

## ADDED Requirements

### Requirement: Event list with roles

The UI SHALL list the caller's events with name, status, and organiser/member role.

#### Scenario: List loads

- **WHEN** an authenticated user opens the list view
- **THEN** the UI renders each entry from `GET /api/v1/events` with its `role` badge and status.

#### Scenario: Empty list

- **WHEN** `GET /api/v1/events` returns `[]`
- **THEN** the UI shows an empty-state message plus the create form.

### Requirement: Create event with required fields

The UI SHALL offer a create form requiring name, dates, and budget, and POST it to `/api/v1/events`.

#### Scenario: Successful create

- **WHEN** the user submits a name, signup/draw/gift dates, `budgetAmount > 0`, and `budgetCurrency`
- **THEN** the UI posts the payload, and on 201 navigates to the new event detail.

#### Scenario: Validation error surfaced

- **WHEN** the backend returns 422 `validation_error`
- **THEN** the UI shows an inline error and keeps the entered values.

### Requirement: Event detail with roster

The UI SHALL render event facts plus the roster from `GET /api/v1/events/:id`, and offer an organiser-only edit form (name, description, dates, budget) issuing `PATCH /api/v1/events/:id` while the event is in draft.

#### Scenario: Detail loads for member

- **WHEN** a participant opens an event they belong to
- **THEN** the UI shows name, dates, budget, status, organiser, and roster display names.

#### Scenario: Forbidden event hidden

- **WHEN** `GET /api/v1/events/:id` returns 403/404
- **THEN** the UI shows a not-authorized-or-missing message, not the roster.

#### Scenario: Organiser edits draft event

- **WHEN** the organiser submits the edit form on a draft event and `PATCH /api/v1/events/:id` returns 200
- **THEN** the UI re-renders the updated facts; on 422 it shows an inline validation error and keeps entered values; on 409 `event_locked` it refreshes to the drawn state.

#### Scenario: Member sees no edit form

- **WHEN** the loaded event has `role: "member"`
- **THEN** the edit form is hidden or disabled.

### Requirement: Invite picker backed by user directory

The UI SHALL let the organiser search users and add participants while the event is in draft.

#### Scenario: Search and add

- **WHEN** the organiser types a query and `GET /api/v1/users?search=` returns matches
- **THEN** the UI lists candidates with an add control posting `{ userId }` to `POST .../participants`.

#### Scenario: Roster reflects auto-joined organiser

- **WHEN** the detail loads for a just-created event
- **THEN** the roster already contains the organiser without any invite step.

### Requirement: Roster removal in draft

The UI SHALL let the organiser remove participants while the event is in draft.

#### Scenario: Remove participant

- **WHEN** the organiser activates remove on a roster entry and `DELETE .../participants/:userId` (path param, no body) succeeds
- **THEN** the UI refreshes the roster without that user.

#### Scenario: Removal after draw blocked

- **WHEN** the event status is `drawn`
- **THEN** remove controls are hidden (backend would reject with 409 `event_locked`).

### Requirement: Exclusions editor with mutual default

The UI SHALL let the organiser add/remove giver-cannot-gift-recipient pairs, defaulting to mutual.

#### Scenario: Add mutual exclusion

- **WHEN** the organiser picks giver, recipient, leaves mutual checked, and POST succeeds with 201
- **THEN** the UI shows the pair as excluded in both directions.

#### Scenario: Add one-way exclusion

- **WHEN** the organiser unchecks mutual before adding
- **THEN** the UI posts `mutual: false` and shows only the single direction.

#### Scenario: Remove exclusion

- **WHEN** the organiser removes an exclusion and DELETE succeeds
- **THEN** the UI drops the pair (and its mirror when mutual was set).

### Requirement: One-shot draw with error display

The UI SHALL offer a draw button to organisers of draft events and surface draw failures.

#### Scenario: Successful draw

- **WHEN** the organiser triggers `POST .../draw` on a draft event and it returns 200
- **THEN** the UI shows the `drawn` status and hides further roster/exclusion/draw editing.

#### Scenario: Impossible draw error

- **WHEN** the endpoint returns 422 `draw_impossible`
- **THEN** the UI shows a draw-impossible message advising the organiser to adjust roster or exclusions.

#### Scenario: Already-drawn conflict

- **WHEN** the endpoint returns 409 `already_drawn`
- **THEN** the UI refreshes to the drawn state instead of showing a generic crash.

### Requirement: Blind my-giftee view

The UI SHALL show the caller only their own giftee via `GET .../my-giftee` and never render other assignments.

#### Scenario: Giftee revealed after draw

- **WHEN** the event is drawn and `GET .../my-giftee` returns 200
- **THEN** the UI shows the giftee displayName.

#### Scenario: No giftee before draw

- **WHEN** the event is still draft and the endpoint returns 404 `not_drawn`
- **THEN** the UI shows a waiting-for-draw message, not an error crash.

#### Scenario: Organiser has no extra visibility

- **WHEN** the viewer is the organiser
- **THEN** the UI shows only the organiser's own giftee, identical to any member.
