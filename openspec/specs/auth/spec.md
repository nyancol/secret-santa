# Auth (OIDC/PocketID session)

User login via PocketID OIDC (authorization-code + PKCE), same shape as `1001-restaurants`.

## Requirements

### Requirement: OIDC login
The system SHALL expose `GET /api/auth/login` returning a 302 redirect to the
provider when OIDC is configured, and 503 `{ error: "auth_not_configured" }`
when it is not.

#### Scenario: Login redirect
- **WHEN** OIDC is configured and a client calls `GET /api/auth/login`
- **THEN** the response is a 302 redirect to the provider authorization URL.

### Requirement: OIDC callback
The system SHALL exchange the authorization code at `GET /api/auth/callback`,
upsert the user by OIDC `sub`, mint a 30-day `HttpOnly` session cookie, and
redirect to `/`. Failures SHALL return 401 without leaking provider details.

### Requirement: Session gate
The system SHALL require a valid session cookie for `/api/auth/*` (except the
public allowlist: login, callback, dev-login probe, logout) and for all
`/api/v1/*` routes, returning 401 `{ error: "unauthorized" }` otherwise.

#### Scenario: Unauthenticated API access
- **WHEN** a client without a session calls `GET /api/auth/me`
- **THEN** the response is 401.

### Requirement: Dev-only stub login
The system SHALL expose `POST /api/auth/dev-login` ONLY when `DEV_LOGIN=true`
AND `NODE_ENV != "production"`. In production the route SHALL NOT exist (404).
Stub identities use `sub = "dev:<name>"` so they are distinguishable from
real OIDC users.

### Requirement: Users persist in SQLite
The system SHALL persist users (`id`, `sub` unique, `displayName`,
`createdAt`, `updatedAt`) in SQLite via the `__migrations`-tracked
`src/db/index.ts` migration chain. Domain tables append as new versions —
migrations MUST stay additive-only so `git revert` rollbacks replay safely.

### Requirement: Prod backup via zerobyte
Prod SQLite (`secret-santa_secret-santa-data`) SHALL be snapshotted nightly by
zerobyte (runbook `.agents/skills/ops-data`; schedule lives in zerobyte).
Restores run ONLY on explicit order. Fresh = newest snapshot younger than 26h.
