# Secret Santa

Minimal hello-world Node.js API with the same DevOps practices as `1001-restaurants`.

## Stack

- Node 26, Fastify 5, TypeScript, pino.
- OTEL → homelab LGTM (`http://lgtm:4318` on the `telemetry` Docker network). Enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — dev/preprod stay dark.
- `GET /` → minimal Secret Santa UI (static `public/`, same-origin).
- `GET /api/health` → `{ status: "ok", service, version, uptime }`.

## Quickstart

```bash
mise run setup      # install tools + enable .githooks/ (betterleaks + commit-msg)
npm ci
mise run dev        # API on http://localhost:3222 (from .env.dev)
mise run check      # typecheck + lint + format:check + tests
```

## Preprod (single slot)

```bash
mise run preprod-up       # http://localhost:5176
mise run preprod-verify   # read-only green check
mise run preprod-deploy --branch <name> [--evict]
mise run preprod-logs
mise run preprod-down
```

PRs to `main` with the `preview` label auto-deploy via `.github/workflows/preprod-preview.yml` (self-hosted runner).

## Prod

Arcane GitOps owns prod (polls `main`, builds, restarts). Agents never touch prod.
Contract: `compose.yaml` + `compose.preprod.yaml` (+ `.env` per environment). Caddy `:8095 → secret-santa:3000`, preprod `:8094 → secret-santa-staging:3000`.

## Layout

```
compose.yaml / compose.preprod.yaml   prod + preprod (caddy_public + telemetry networks)
Dockerfile                            multi-stage node:26-slim, non-root, /api/health check
mise.toml                             node/betterleaks/opencode/openspec/firecrawl/stitch + tasks
opencode.jsonc                        firecrawl plugin + stitch MCP (STITCH_ACCESS_TOKEN)
openspec/                             spec-driven changes (project.md + specs/hello-world)
.agents/skills/ops*                   runbooks: observe / preview / incident / runner / ship (+ router)
.opencode/skills/*                    openspec + stitch-loop + UI taste skills
.github/workflows/                    ci / sast / release / preprod-preview (self-hosted)
.githooks/                            betterleaks pre-commit + Conventional Commits commit-msg
```

## Ops skills

| Need                    | Skill                                          |
| ----------------------- | ---------------------------------------------- |
| Observe via LGTM        | `.agents/skills/ops-observe` (`lgtm-query.sh`) |
| Preprod deploy + verify | `.agents/skills/ops-preview`                   |
| Prod watch + rollback   | `.agents/skills/ops-incident`                  |
| Runner health           | `.agents/skills/ops-runner`                    |
| Patching + releases     | `.agents/skills/ops-ship`                      |
| Router + conventions    | `.agents/skills/ops`                           |

Quotas/billing (`quota-check.sh`, Google tables in `ops-observe`) and Google-refresh data ops from `1001-restaurants` are kept as dormant patterns — no external API spend yet. The zerobyte backup runbook (`ops-data`) is live: prod SQLite is snapshotted nightly, restores run only on explicit order.

## Conventional Commits

`feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert[(scope)]: subject` — enforced by `.githooks/commit-msg`.
