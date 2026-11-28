# Tasks

## 1. Static serving + shell

- [x] 1.1 Add `@fastify/static` dep, register `public/` serving, remove `GET /` hello JSON (serve `public/index.html` instead), carve non-`/api/` paths out of the JSON 404 handler; verify `/` serves the UI, `/api/health` still 200, `/api/*` misses still JSON 404.
- [x] 1.2 Build header + session module (`app.js`): `GET /api/auth/me` with credentials, login link to `/api/auth/login`, `POST /api/auth/logout` button, 401 → anonymous state; verify logged-out shows Login and logged-in (dev-login/OIDC) shows displayName + Logout.

## 2. Event list + create

- [x] 2.1 Render event list from `GET /api/v1/events` with role badges, status, empty state, and list→detail navigation; verify against seeded organiser + member sessions.
- [x] 2.2 Build create form (name, signup/draw/gift dates, budget amount + currency required) posting to `POST /api/v1/events`, 201 → detail, 422 inline; verify invalid payload keeps values and shows the error.

## 3. Event detail: roster, exclusions, draw, giftee

- [x] 3.0 Build organiser edit form on detail (name, description, dates, budget) issuing `PATCH /api/v1/events/:id` in draft only, hidden for members; verify 200 re-renders, 422 inline keeps values, 409 `event_locked` refreshes to drawn.
- [x] 3.1 Render detail from `GET /api/v1/events/:id` (facts + roster) with 403/404 message path; verify member and non-member views.
- [x] 3.2 Build invite picker (`GET /api/v1/users?search=` + `POST .../participants`) and roster remove (`DELETE .../participants/:userId` path param, no body), organiser + draft-gated; verify add/remove round-trips refresh the roster.
- [x] 3.3 Build exclusions editor (giver/recipient selects from roster, mutual checked by default, add + remove); verify mutual creates both directions and uncheck creates one.
- [x] 3.4 Build draw button + `my-giftee` view: `POST .../draw` success → drawn state, 422 `draw_impossible` banner, 409 refresh; `GET .../my-giftee` shows own giftee or waiting message; verify organiser sees only own giftee.

## 4. Participation: profile, wishlist, directory

- [x] 4.1 Build own profile/address form (`PUT .../profile` upsert) with 422 inline handling; verify save round-trips the saved state.
- [x] 4.2 Build wishlist CRUD + reorder (list/add/PATCH/DELETE with `position` moves); verify add/edit/delete/move persist in listed order.
- [x] 4.3 Render participant directory from `GET .../participants` (names, profiles, wishlists; no assignment data); verify directory shows all members and no assignment mapping exists in code or DOM.

## 5. Integration check

- [x] 5.1 Walk the full flow (login → create → invite → exclusions → profile/wishlist → draw → giftee + directory) in dev and confirm no console errors, no CSP violations, and state-changing calls pass the CSRF guard.
