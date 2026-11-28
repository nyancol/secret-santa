# Proposal

## Why

The `secret-santa-events` backend is complete (REST under `/api/v1/events`, invite picker, draw, my-giftee, profiles/wishlist, directory, OIDC session auth) but has no user interface. Organisers and participants currently need curl to use it. A minimal same-origin UI unblocks manual testing and real use without adding a frontend toolchain.

## What Changes

- Serve a minimal static UI from the Fastify backend (same origin, no CORS, no new framework):
  - Header with OIDC login/logout + `me` display (`GET /api/auth/me`, `POST /api/auth/logout`, login via `GET /api/auth/login` redirect).
  - Event list page: my events with `organiser`/`member` role badges, status; create-event form (name, dates, budget required).
  - Event detail page: event facts, roster with remove (organiser, draft only), invite picker (`GET /api/v1/users?search=`), exclusions editor (mutual default, add/remove), draw button with `draw_impossible` error display, my-giftee view (blind organiser — same endpoint, no assignments leak).
  - Profile/address form (own `PUT .../profile` upsert per event).
  - Wishlist CRUD + reorder (POST/PATCH/DELETE with `position`).
  - Participant directory (profiles + wishlists, never assignments).
- No styling system (plain semantic HTML + minimal inline CSS), no pagination (backend caps at 50 users), no notifications, no re-draw (one-shot draw stands).

## Capabilities

### New Capabilities

- `santa-ui-shell`: auth header, session handling, same-origin API client behavior, page routing and role-gated rendering.
- `santa-ui-events`: event list, event creation, event detail, roster invite/remove, exclusions editor, draw trigger with error display, my-giftee reveal.
- `santa-ui-participation`: own profile/address form, own wishlist CRUD + reorder, participant directory view.

### Modified Capabilities

- `hello-world`: `GET /` root greeting JSON removed — `/` now serves the UI entry point. `GET /api/health`, telemetry gating, and shutdown behavior are unchanged.

## Impact

- Code: new static assets (e.g. `public/` HTML + vanilla JS) served by Fastify same-origin; `registerSecurity` CSP already allows `scriptSrc 'self'` + inline styles — no CSP change expected; `GET /` root greeting JSON removed (serves UI entry point); `setNotFoundHandler` gains a carve-out so non-`/api/` page routes serve the UI.
- APIs: no new endpoints; UI consumes `GET/POST /api/auth/*` and existing `/api/v1/*` only.
- Dependencies: `@fastify/static` (serve-only) is the only new dep; no bundler, no framework.
