---
name: ops-preview
description: Deploy a branch to the single preprod staging slot and verify it green for requestor validation. Mutates preprod — invoke explicitly (e.g. /skill:ops-preview).
disable-model-invocation: true
---

# Secret-Santa Preview Skill

> Orca guardrail: **Secret-Santa Builder** uses this skill verify-only
> (`preprod-verify`, local preprod-up equivalent). Never add the `preview`
> label, never run `preprod-deploy --evict`, never tear down another branch's
> slot. Prepare the claim/teardown commands; the human executes. See
> `.agents/SPEC_GATED_WORKFLOW.md` + router `ops` skill.

Deploy a branch to the single staging slot for requestor validation.
Project `secret-santa-preprod`, container `secret-santa-staging`, volume
`secret-santa-preprod-data`. The slot file records `SLOT_BRANCH` / `SLOT_SHA` /
`SLOT_SINCE` / `SLOT_VALIDATED`: repo-local `.preprod-slot` (gitignored) for
manual runs, `$PREPROD_SLOT_FILE` (`/tmp/secret-santa-preprod-slot` on the
persistent runner filesystem) in CI — runner workspaces do not reliably
persist untracked files between runs.

Sources of truth: `compose.preprod.yaml`, `Dockerfile`, `mise.toml`
(preprod tasks).

Secrets and docker-access conventions follow the family conventions in the
`ops` router skill — load `.agents/skills/ops/SKILL.md` if not already
loaded.

## Shared context

* Tier ports (authoritative: `compose.yaml` / `compose.preprod.yaml`): dev API
  `3222`; preprod container `3000` / host `5176` (Caddy
  `:8094 -> secret-santa-staging:3000`); prod container `3000` (Caddy
  `:8095 -> secret-santa:3000`), no host publication. Host `5176` avoids
  colliding with 1001-restaurants dev/preprod on the same homelab host.
  The Arcane-managed prod
  `.env` MUST NOT set `HOST_PORT` (base `compose.yaml` only `expose:`s it;
  the variable is dead weight that invites a harmful publish).
* Docker access: `.agents/skills/ops-preview/scripts/lib-docker.sh` (sourced by the preprod scripts)
  auto-detects — runs docker directly when `docker info` already works,
  sudo only when needed. `mise run preprod-up/down/logs` honor the same
  rule. Override explicitly per host: `DOCKER_SUDO=""` (never sudo) or
  `DOCKER_SUDO="sudo"` (always sudo). If a box's sudo demands a TTY
  password, non-interactive runs must use `DOCKER_SUDO=""` (when docker
  allows it) or fix group membership — never pipe a password.

## Deploy

```bash
mise run preprod-deploy --branch <name> [--evict]
# Stateless hello-world: no DB reseed step (`--fresh-db` is accepted as a
# no-op for workflow compatibility). Without --evict, a slot owned by
# another branch is refused, not replaced.
```

CI behavior (`.github/workflows/preprod-preview.yml`, self-hosted runner):
the `preview` label on a PR to `main` controls whether it builds.
Label added (or slot owned by another branch) deploys with
`--evict`; `synchronize` on the already-deployed branch rebuilds
statelessly. Deploy, eviction,
teardown, and red verdict details include branch, SHA,
health body, green/red cause — never secrets. On PR close or label removal
the workflow tears the preview down only if that PR's branch owns the slot.
Same-repo branches only; fork PRs are refused. Manual `mise run
preprod-deploy` stays available as fallback and re-records the slot.

Rules:

- The wrapper never switches branches: current checkout must equal
  `--branch` or it refuses (avoids destructive checkout surprises).
- Refusal message states owner branch, owner-since, and last validation so
  the requestor knows who to ask. Take no destructive action on refuse.
- `--evict` is the only path that replaces another branch's preview; say
  so explicitly in the evidence post.
- Never copy anything from prod `secret-santa-data` into preprod (privacy).

## Preprod green (all must hold)

- Container `secret-santa-staging` UP longer than 30s.
- Staging `GET /api/health` → 200 with `db: ok` **at the
  `APP_ORIGIN` URL from `.env.preprod`**, not just localhost in the container.
- Running build matches the slot commit (`build-from-checkout` assumption is
  recorded, not hidden).
- `GET /api/auth/login` redirects (3xx). `503` = OIDC not configured yet
  (accepted pre-PocketID wiring; fails the check only on other codes).
- Boot logs contain no `Invalid config` lines.

Read-only check any time:

```bash
mise run preprod-verify                 # all green signals
```

Exit codes: `0` = green, `1` = red, `2` = check errored (docker
unreachable, indeterminate — NOT a red, fix access
and re-run). Only exit-1 runs count toward the consecutive-failure
threshold (see `ops-incident` skill).

## Evidence summary

```
[PREVIEW] branch <name> @ <short-sha> — GREEN | RED (<cause>)
staging: <APP_ORIGIN>  direct: http://localhost:5176
health: <health body>  login: <3xx|503-not-configured>
slot: <owner-since>  evicted: <previous-branch|none>
```

RED names the failing signal plus the relevant log excerpt.
