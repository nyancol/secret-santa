---
name: ops-data
description: SQLite backup/restore for "secret-santa" via zerobyte (provisions volumes + repos; restores run ONLY on explicit order). Use when checking snapshot freshness or restoring prod data after an explicit order.
---

# Secret-Santa Data Skill

> Orca guardrail: the `docker stop` / zerobyte-restore-into-volume /
> `docker start` + `docker exec` integrity-check sequence below is the SOLE
> exception to the router's "never restart/exec prod" rule, and runs ONLY on
> explicit order. Without one: assess + prepare the exact steps, do not
> execute. **Secret-Santa Planner** never touches this skill. See
> `.agents/SPEC_GATED_WORKFLOW.md` + router `ops` skill.

SQLite backup / restore via zerobyte → Pi REST. The only writer to app data
outside the app itself — and it stays narrow: restores replace the prod
volume only on explicit order.

Sources of truth: the zerobyte UI/schedule plus `src/db/index.ts` (migrations).

## Backup (zerobyte → Pi REST)

Prod SQLite (`secret-santa_secret-santa-data`, WAL mode) is snapshotted nightly by
zerobyte (nightly job, see schedule in the zerobyte UI). Restore procedure (restores run ONLY on
explicit order) plus freshness verification: before any rollback, in the
weekly RED report, or whenever asked.

### Freshness check

- Fresh = newest snapshot for source `Secret-Santa` in repo `secret-santa-in-pi`
  is younger than 26h and contains `app.db` (+ `-wal`/`-shm`). Check in the
  zerobyte UI snapshot list.
- If stale or failing: state repo, last-good snapshot age, and the
  job error — then fix the job in zerobyte.

### Restore

```bash
docker stop secret-santa
# in zerobyte UI: restore newest green snapshot of `Secret-Santa` into secret-santa_secret-santa-data
docker start secret-santa
# integrity + health:
docker exec secret-santa node -e "const D=require('better-sqlite3');const db=D('/data/app.db',{readonly:true});console.log(db.prepare('PRAGMA integrity_check').get());db.close()"
curl -sS https://secret-santa.patates.club/api/health  # want 200 {"status":"ok","db":"ok",...}
```

- Rehearsal first (before trusting a new repo, yearly after): restore to an
  empty temp volume, serve with a scratch container, `integrity_check` =
  `ok` + health `db: ok`. `secret-santa-preprod-data` is never a restore
  source or target for prod.
- Report only counts and verdicts; never dump row contents beyond what the
  API already exposes.

### Migration-safety note (for `ops-incident` rollbacks)

Migrations are additive-only (`src/db/index.ts`, `__migrations` table):
`CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX` replay safely.
Any `DROP`, `RENAME`, or table-rebuild migration blocks automatic revert —
restore `/data` from backup first, then revert, then redeploy.

### What NOT to do

- Never restore without an explicit order; without one: produce the
  assessment and prepare the exact restore steps, do not execute them.
- Never restore a snapshot that failed `integrity_check` without flagging
  it and proposing the previous snapshot instead.
- Never copy prod data into preprod outside documented demo seeding.

## Not in scope (vs 1001-restaurants)

The reference `ops-data` skill also covers ad-hoc Google Places snapshot
refresh sweeps (per-place M2M `POST /api/places/:id/refresh`). Secret-santa
has no billable upstream and no refresh endpoint — that part is intentionally
not ported. Re-add it if a refresh-style endpoint lands.
