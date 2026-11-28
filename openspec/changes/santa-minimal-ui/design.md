# Design

## Context

See proposal.md (Why). Backend facts shaping the design (verified in `src/`):

- Fastify 5 + `@fastify/cookie`; session is an HttpOnly `SameSite=Lax` cookie; `/api/v1/*` requires it (`src/app.ts` onRequest guard, 401 otherwise).
- OIDC login is a server redirect flow: `GET /api/auth/login` → 302 to IdP, `GET /api/auth/callback` sets the cookie and 302s to `/`. `GET /api/auth/me` returns `{ id, displayName }`; `POST /api/auth/logout` clears the cookie.
- CSRF guard (`src/security.ts`): state-changing `/api/*` calls presenting a cookie must carry a same-origin `Origin`/`Referer`; no token needed for a same-origin UI; no CORS is registered — the UI MUST be same-origin.
- CSP (`registerSecurity`): `scriptSrc 'self'`, `styleSrc 'self' 'unsafe-inline'` — external scripts/CDN are blocked; inline event handlers should be avoided in favor of `addEventListener` in same-origin `.js` files.
- No frontend exists: no `public/`, `frontend/`, or `client/` dir; no bundler. Backend change `secret-santa-events` owns all `/api/v1/events/*`, `/api/v1/users`, profile/wishlist/directory routes — no new endpoints needed.
- `setNotFoundHandler` currently returns JSON 404 for every path; the UI needs a carve-out for page routes.

## Goals / Non-Goals

**Goals:** same-origin static UI covering auth header, event list/create/detail, invite picker, roster remove, exclusions editor, draw + `draw_impossible` display, my-giftee, profile form, wishlist CRUD + reorder, directory — testable with `npm run dev` + real OIDC (or `DEV_LOGIN` in dev).

**Non-Goals:** styling system, pagination, notifications/email, re-draw, event delete, PocketID admin import, client-side router framework, offline support.

## Decisions

### 1. Static files under `public/`, served by `@fastify/static` — no bundler

- What: `public/index.html` (list + create + header), `public/event.html` (detail; event id via `?id=`), `public/app.js` (shared fetch + session header), `public/styles.css` (minimal). Fastify registers `@fastify/static` for `public/`; only new dependency.
- Why: CSP forbids external scripts, so no CDN framework; a bundler (Vite) is overkill for ~5 forms. Vanilla JS keeps the change reviewable and matches "minimal and testable".
- Alternative considered: Vite SPA in `frontend/` with dev proxy — rejected: adds toolchain, CORS/proxy config, and build step for no spec benefit.
- Page model: two query-param pages (`/` and `/event.html?id=...`) instead of history routing — no server fallback rewrite needed beyond serving static files; back-link returns to `/`.

### 2. Auth wired as links + credentialed fetch, no JS token handling

- Login: plain `<a href="/api/auth/login">` (must be full navigation — the endpoint 302s to the IdP; `fetch` would not complete the flow).
- Session check: `fetch("/api/auth/me", { credentials: "include" })`; 401 → anonymous header; 200 → name + logout button.
- Logout: `fetch("/api/auth/logout", { method: "POST", credentials: "include" })` then re-check `me`. POST (not a link) so the CSRF guard sees a same-origin POST; browser attaches `Origin` automatically.
- DEV_LOGIN (`POST /api/auth/dev-login`, dev only) gives a local login button when OIDC is unconfigured — dev/test convenience only, hidden when `me` succeeds or in production.

### 3. CSRF needs no extra code — same-origin fetch is sufficient

- All API calls use relative URLs + `credentials: "include"`. Browser sends `Origin`/cookie; `isSameOrigin` passes. No CSRF token, no custom header.
- Rule: never `fetch` with `mode: "no-cors"` or cross-origin absolute URLs; never suppress the `Origin` header.

### 4. `GET /` serves the UI; `setNotFoundHandler` carve-out keeps `/api/*` JSON contract

- `GET /` root greeting JSON is removed (hello-world placeholder retired) and serves `public/index.html` instead. `GET /api/health` and all `/api/*` behavior unchanged.
- `if (req.url.startsWith("/api/"))` → JSON 404 (unchanged). Non-API unknown paths serve `public/index.html` (or 404 text) so page reloads on `/event.html?id=` work when served from disk layout. Static plugin handles exact files; the handler only covers misses.

### 5. Rendering: role/status-gated vanilla DOM, full re-fetch after mutations

- After every mutation (create, invite, remove, exclusion add/remove, draw, profile save, wishlist op) re-GET the affected resource and re-render. No optimistic state — avoids divergence on 403/409/422.
- Gate organiser controls on the `role` field of `GET /api/v1/events` entries and on `status === "draft"`; re-check after draw (status flips to `drawn`).
- Errors: map `error` codes to UI strings — `draw_impossible` → "No valid draw with current roster/exclusions…", `already_drawn` → refresh to drawn, `validation_error` → inline field error, 401 → anonymous state, 403/404 on detail → not-authorized message.

### API mapping table

| UI action | Method + path | Req body | Success | Errors shown |
|---|---|---|---|---|
| Session | `GET /api/auth/me` | — | `{ id, displayName }` | 401 → login prompt |
| Login | `GET /api/auth/login` (navigate) | — | 302 → IdP → `/` | 503 `auth_not_configured` → notice |
| Logout | `POST /api/auth/logout` | — | `{ ok: true }` | — |
| List events | `GET /api/v1/events` | — | `[{ …, role }]` | 401 → login |
| Create | `POST /api/v1/events` | `name, signupDeadline?, drawDate?, giftDate?, budgetAmount, budgetCurrency, description?` | 201 event | 422 inline |
| Detail | `GET /api/v1/events/:id` | — | event + `roster` | 403/404 → message |
| User search | `GET /api/v1/users?search=` | — | `[{ id, displayName }]` (max 50) | — |
| Invite | `POST .../participants` | `{ userId }` | 201 | 404 unknown user; 409-ish non-draft |
| Remove | `DELETE .../participants/:userId` (path param, no body) | — | `{ removed: true }` | 404 already gone; 409 `event_locked` when drawn |
| Excl add | `POST .../exclusions` | `{ giverId, recipientId, mutual=true }` | 201 | 422 self/non-member |
| Excl del | `DELETE .../exclusions` | `{ giverId, recipientId, mutual }` | `{ removed }` | — |
| Draw | `POST .../draw` | — | `{ status: "drawn" }` | 422 `draw_impossible`; 409 `already_drawn` |
| Giftee | `GET .../my-giftee` | — | `{ giftee: { id, displayName } }` | 404 `not_drawn` → waiting msg |
| Profile save | `PUT .../profile` | address fields + notes | `{ profile }` | 422 inline |
| Wishlist list | `GET .../wishlist` | — | `[items]` ordered | — |
| Wish add | `POST .../wishlist` | `{ label, url?, priceHint?, priority?, position? }` | 201 item | 422 inline |
| Wish edit/move | `PATCH .../wishlist/:itemId` | partial + `position` | updated item | 403 others' item (own list only calls own) |
| Wish del | `DELETE .../wishlist/:itemId` | — | `{ removed: true }` | — |
| Directory | `GET .../participants` | — | profiles + wishlists, no assignments | 403/404 → message |

## Risks / Trade-offs

- [Risk] Full re-fetch after each mutation feels chatty → Mitigation: acceptable for minimal UI; payloads are tiny (roster/directory are single queries).
- [Risk] `public/` static serving + helmet CSP could block inline handlers → Mitigation: all JS in external `app.js`/`event.js` with `addEventListener`; keep `style` inline-only (allowed).
- [Risk] Query-param routing (`event.html?id=`) is unfashionable → Mitigation: zero router code, deep-linkable, back-button-safe; upgrade path to history routing later without spec changes.
- [Risk] Invite picker capped at 50 users, no pagination → Mitigation: matches backend contract; out of scope per proposal Non-Goals; search narrows results.
- [Risk] Blind-organiser relies on backend (no assignments endpoint exists) → Mitigation: UI simply never requests anything outside the table above; privacy holds by construction.
