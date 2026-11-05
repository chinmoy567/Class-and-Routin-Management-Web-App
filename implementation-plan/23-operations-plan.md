# Plan: Spec 23 — Operations

## Context
Spec 23 (`.claude/specs/23-operations.md`, status Draft) makes the app run reliably on one server: Docker Compose, Mongo replica set with users and an audit-log role, Caddy HTTPS, ClamAV, secrets, CI/CD, migrations, backups, monitoring, load test, email DNS, launch checklist. No application features. Nothing exists yet except `.github/workflows/ci.yml` (lint/test/build) and `GET /api/health`. Saved to `implementation-plan/23-operations-plan.md` after approval.

## Blockers (need your answer; PRD open question 5 and spec "Open")
1. **Hosting** (university VM vs rented VPS): blocks only the real deploy. Everything is written host-agnostic.
2. **Off-site backup target**: blocks OPS-08 copy step. Plan: script pushes via `rclone` to a configurable remote (`BACKUP_REMOTE`), encrypted with `age`; remote chosen later.
3. **Email provider/domain, real @baiust.ac.bd mailbox** (OPS-15): only a DNS checklist doc + a `send-test-email` script can be done; actual DNS and inbox test are manual and stay open.
4. **PITR (OPS-09)**: plan self-managed oplog archiving (every 10 min). Atlas is the alternative; say if you prefer it.
5. **Uptime/alert service (OPS-11)**: needs an external account (e.g. UptimeRobot). I write the config guide only.

Anything needing an external account, DNS or a real server is documented, not faked, and reported as open.

## Rules / acceptance checklist
OPS-01..16 and the six acceptance tests in the spec. Mapping to artifacts below. Tests that need a live server (port 27017 closed, HTTP→HTTPS redirect, restore, uptime alert, load pass) are runnable scripts/runbooks, not Vitest.

## Files
- `server/Dockerfile`, `client/Dockerfile` (Vite build → copied into Caddy image), `.dockerignore` (OPS-01, 05; HEALTHCHECK on `/api/health`)
- `deploy/docker-compose.yml`: caddy, server, mongo (replica set `rs0`, auth, keyfile, no published port), clamav (freshclam auto-update), backup sidecar; `restart: unless-stopped`, healthchecks, log driver `json-file` max-file 14 (OPS-01,03,05,12)
- `deploy/Caddyfile`: auto HTTPS, HTTP→HTTPS, HSTS, `/api` + `/socket.io` reverse proxy with WS, static client (OPS-02)
- `deploy/mongo/init-replica.sh`, `init-users.js`: rs.initiate, app user (`readWrite` + custom role denying audit_log update/delete: role `appNoAuditMutate` built from explicit actions — readWrite on all but `audit_log` where only `find`,`insert`), backup user (`backup` role) (OPS-03)
- `deploy/.env.production.example` (secrets list, chmod 600 note), `docs/key-backup.md` (OPS-04)
- `.github/workflows/ci.yml` (PR-only lint/test/build) + `.github/workflows/images.yml` (on main: build and push images) ; `docs/deploy.md` with the one-command deploy and the protected-hours rule (OPS-06)
- `server/migrations/` + `server/src/lib/migrate.js` + `server/scripts/migrate.js`: runner records `migrations` collection (unique `name`, `ran_at`); `npm run migrate -w @crm/server`. Test: `server/src/lib/__tests__/migrate.test.js` runs once, skips on rerun, concurrent runs run each once (OPS-07)
- `deploy/backup/backup.sh`, `oplog-archive.sh`, `restore.sh`, `crontab` (02:30 dump `--oplog` incl. GridFS, encrypt, rclone, 30-day prune) ; `docs/restore-runbook.md`, `docs/restore-log.md` (OPS-08,09,10)
- Monitoring: `docs/monitoring.md` (external check every minute, 2 failures); `server/src/lib/errorCounter.js` (pino level≥50 counter, alert mail at >20/5 min via existing mail service); daily ops email Agenda job reporting failed jobs + ClamAV down, in existing jobs module (OPS-11..13). Unit tests for counter and report job.
- `loadtest/k6-script.js` + `loadtest/README.md`: 2,000 sign-ins in 5 min, 100 rps, thresholds p95 dashboard/routine <300 ms, free-room <500 ms, chat <2 s, 0 errors (OPS-14). Note: k6 is a dev tool outside the app stack — **needs your OK** (CLAUDE.md: no unlisted libraries).
- `docs/email-dns.md` + `server/scripts/send-test-email.js` (OPS-15)
- `docs/launch-checklist.md` (OPS-16)
- `DOCUMENTS/README.md`/spec status: set spec 23 to In progress.

## Data model
Only `migrations` (name unique index, ran_at). Runner uses the unique index so concurrent runs cannot double-apply. No other app schema change.

## API / UI
None. The existing `/api/health` is reused unchanged.

## Tests
Vitest: migration runner (OPS-07), error counter threshold (OPS-12), ops email report (OPS-13). Script-level checks documented in `docs/verify-ops.md`: nmap/port 27017 closed, audit_log update/delete refused for the app user (mongosh script), `curl -I` redirect + HSTS, restore into scratch, stop mongo → alert, k6 thresholds.

## Build order
1. Migration runner + tests. 2. Error counter + ops email job + tests. 3. Dockerfiles, compose, Caddyfile. 4. Mongo init scripts + audit role verify script. 5. Backup/restore scripts + runbook. 6. CI/image workflow + deploy doc. 7. Load test. 8. Docs: env/keys, monitoring, email DNS, launch checklist. 9. Run lint/tests/build; validate compose with `docker compose config` if Docker present.

## Out of scope
Application features, actual provisioning, DNS changes, creating external accounts, running the deploy.

## Verification
`npm run lint && npm test && npm run build`; `docker compose -f deploy/docker-compose.yml config`; the doc'd script checks on a real host later.
