# Spec Delta

## Purpose

Provides the authenticated shell of the minimal UI: login/logout, current-user display, same-origin API access, page routing, and role-gated rendering shared by all screens.

## ADDED Requirements

### Requirement: Session display and OIDC login entrypoint

The UI SHALL show the current session state and offer OIDC login via full-page redirect.

#### Scenario: Anonymous visitor sees login

- **WHEN** `GET /api/auth/me` returns 401
- **THEN** the header shows a Login control linking to `GET /api/auth/login` (full-page navigation, not fetch).

#### Scenario: Authenticated user sees identity

- **WHEN** `GET /api/auth/me` returns 200 with `{ id, displayName }`
- **THEN** the header shows the displayName (or id fallback) and a Logout control.

### Requirement: Logout clears session

The UI SHALL log out via `POST /api/auth/logout` and refresh session state.

#### Scenario: Successful logout

- **WHEN** the user activates Logout and the endpoint returns 200
- **THEN** the UI re-queries `GET /api/auth/me` and renders the anonymous state.

### Requirement: Same-origin API client with credentials

All API calls SHALL be same-origin `fetch` with credentials included so the session cookie is sent and the Origin/Referer CSRF guard passes.

#### Scenario: State-changing request passes CSRF guard

- **WHEN** the UI issues POST/PUT/PATCH/DELETE to `/api/*` from the served origin
- **THEN** the browser Origin matches the app origin and no 403 `forbidden` CSRF rejection occurs.

#### Scenario: Expired session redirects to login state

- **WHEN** any `/api/v1/*` call returns 401
- **THEN** the UI renders the anonymous header state instead of the protected content.

### Requirement: Minimal page routing and role-gated rendering

The UI SHALL provide an event-list view and an event-detail view addressed by event id, and SHALL gate organiser-only controls on the event `role` field.

#### Scenario: Navigate from list to detail

- **WHEN** the user selects an event in the list
- **THEN** the UI shows the detail view for that event id and offers a way back to the list.

#### Scenario: Member does not see organiser controls

- **WHEN** the loaded event has `role: "member"`
- **THEN** invite, roster-remove, exclusion-edit, draw, and event-edit controls are hidden or disabled.

#### Scenario: Unauthenticated deep link

- **WHEN** an anonymous user opens an event-detail URL
- **THEN** the UI shows the login prompt instead of event data.
