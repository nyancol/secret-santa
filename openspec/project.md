# Secret Santa — Project Constitution

Fastify + TypeScript minimal API ("hello world") with OTEL telemetry to the
homelab LGTM stack. Same DevOps shape as `1001-restaurants`:

- `mise` for tooling, `compose.yaml` + `compose.preprod.yaml` for
  prod/preprod, shared `caddy_public` + `telemetry` networks.
- Spec-gated workflow: 1 OpenSpec change = 1 branch, human merges.
- Preprod: single slot (`secret-santa-preprod`), host `5176`, container `3000`.
- Prod: container `3000`, no host publish, Caddy-routed.

## Tech stack

- Runtime: Node 26, Fastify 5, pino logging.
- Telemetry: `@opentelemetry/sdk-node` + OTLP/HTTP exporters (traces/metrics/logs),
  health-span filter, low-cardinality metric views. Enabled only when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is a valid http(s) URL.
- Tests: vitest + coverage gates (mirror `ci.yml` verify job).
- Secrets: betterleaks pre-commit hook + CI scan; never commit `.env*`.

## Conventions

- `GET /` → `{ hello: "world", service, version, origin }`.
- `GET /api/health` → `{ status: "ok", service, version, uptime }`.
- New endpoints go under `/api/v1/*` (versioned contract).
- `APP_ORIGIN` is the single per-deployment host variable.
- Graceful shutdown: SIGTERM/SIGINT → drain → OTEL flush → exit (20s grace).
