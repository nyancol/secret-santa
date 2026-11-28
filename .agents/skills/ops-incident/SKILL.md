---
name: ops-incident
description: Prod incident handling for "secret-santa" — prod health/version watch and the git-revert rollback runbook. Use when prod looks down, prod version drifts from main, or a rollback is explicitly ordered.
---

# Places Incident Skill

> Orca guardrail: incident rollback is the ONLY path that pushes to `main`
> directly (`git revert` + push so Arcane redeploys) — the spec gate does not
> apply to prod-down recovery. Still never merge a PR, never claim preprod,
> never push `v*` tags. Runs ONLY on explicit order; otherwise assess +
> prepare commands, do not execute. See `.agents/SPEC_GATED_WORKFLOW.md`.

Prod health + version watch and git-revert rollback. The agent
verifies and prepares — Arcane owns deploys. Rollback runs ONLY on explicit
order.

Sources of truth: `compose.yaml` (prod service), this skill (green definition).

Secrets, deploy ownership (Arcane), and the explicit-order gate follow the
family conventions in the `ops` router skill — load
`.agents/skills/ops/SKILL.md` if not already loaded.

## Shared context

* Tier ports (authoritative: `compose.yaml`): prod container `3000`
  (Caddy `:8095 -> secret-santa:3000`), no host publication. The Arcane-managed
  prod `.env` MUST NOT set `HOST_PORT`.
* Telemetry: prod `secret-santa` exports OTLP/HTTP to `http://lgtm:4318`.
  Query LGTM per the `ops-observe` skill access section (Grafana
  `http://localhost:3001` + `lgtm-query.sh`, service-account token) —
  never `docker exec` for reads. Every signal carries `service.name="secret-santa"`,
  `deployment.environment="production"`. A signal gap with steady 200s =
  exporter break, not zero users (see `ops-observe` skill for the RED lens).
* Thresholds: alert after 3 consecutive failures, 10m
  version-stuck grace after a merge.

---

## Prod watch

### Prod green (all must hold)

- `GET <prod-health-url>` → 200 with `db: ok`.
- Running version equals `main` HEAD past the merge grace window
  (`version-stuck` with expected-vs-running versions otherwise).
- Boot logs show OIDC discovery ok; `/api/auth/login` does not 503.
- No sustained 5xx on API routes (RED lens from `ops-observe`).
- OTEL signals for the running version are visible in LGTM. A signal gap
  with steady 200s = exporter break, not zero users.
- Container `PORT` equals the Caddy `reverse_proxy secret-santa:<PORT>` target
  and health passed at the declared URL (catches env-to-Caddy drift).

### Assessment templates (evidence-backed, never secrets)

```
[PROD RED] <cause: down|version-stuck|oidc-config|5xx|exporter-break>
health: <body or unreachable>
running: <version>  expected(main): <sha>  since: <UTC time>
logs: <tail excerpt, secrets redacted>
next: watching; rollback only on your order (see below)
```

```
[PROD GREEN] recovered at <UTC time> (was <cause>, red for <duration>)
running: <version>  health: <body>
```

### What NOT to do

- Never build, restart, or `exec` into prod; never touch prod `/data`
  (family deploy-ownership rule, `ops` skill).
- Never include secret values (family secrets rule, `ops` skill):
  presence/shape only, e.g. `SESSION_SECRET set, length ok`.

---

## Git-revert rollback

Rollback is `git revert` of the offending commit on `main` + push so Arcane
redeploys. No direct prod rebuild, no image pinning — one deploy mechanism.

### Gate

- Run ONLY on explicit order (`revert <sha>`, `roll back prod`).
  Without an order: produce the prod-watch assessment above and prepare the exact
  commands, do not execute them.

### Migration-safety pre-check (must pass before revert)

```bash
git show --stat <sha>                # what did it touch?
git show <sha> -- src/db/index.ts    # migration SQL, if any
```

- PASS: `src/db/index.ts` untouched, or the diff adds only `CREATE TABLE`,
  `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`, or `INSERT` statements.
- BLOCK: any `DROP`, `RENAME`, table rebuild (`*_new` swap pattern),
  backfill that rewrites existing rows, or any change outside additive SQL.
  On BLOCK: refuse the automatic revert and propose manual recovery instead
  (restore `/data` volume from backup — see `ops-data` skill — then revert,
  then redeploy).

### Execute + verify

```bash
git revert --no-edit <sha> && git push origin main
# then: prod green per the definition above (version advances to the revert commit)
```

Report the revert commit, the push result, and the post-revert green check.
If green does not return within the Arcane poll window + build time, escalate
with fresh evidence — do not stack further reverts blindly.

### Dry run (no push)

For rehearsal or approval: run the pre-check, print the exact `git revert` command
that WOULD run, and stop.
