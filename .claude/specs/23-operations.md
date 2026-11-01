# 23: Operations

All releases · Status: Draft · Depends on: 00 · PRD: Non-functional requirements (Targets, Availability & data, Security), Technical approach (Hosting) · Diagrams: 23-deployment

## Goal

The app runs on one server reliably enough for the PRD's targets: 99.5% uptime on teaching hours, daily backups with point-in-time recovery, HTTPS everywhere, and a way to see when something breaks.

## Scope

**In:** Docker Compose setup, MongoDB replica set and its users, Caddy and HTTPS, ClamAV, environment and secrets, CI/CD, backups and restore tests, monitoring and logs, the load test, email domain setup, the launch checklist.

**Out:** application features.

## Requirements

### Runtime
- **OPS-01** Docker Compose runs: `caddy` (HTTPS, serves the built client, proxies `/api` and `/socket.io` to the server), `server` (Node.js 24, the API, Socket.IO and Agenda), `mongo` (MongoDB 7+, a replica set; a single-node replica set is acceptable, a 3-node set is better), and `clamav` (clamd, with automatic signature updates).
- **OPS-02** Caddy gets certificates automatically, redirects HTTP to HTTPS, and sets HSTS. WebSocket upgrade is proxied.
- **OPS-03** MongoDB isn't reachable from outside the Docker network. Authentication is on. The app user has `readWrite` on the app database, except `audit_log`, where a custom role grants only `find` and `insert` (spec 00 FND-20). A separate backup user has `backup` rights only.
- **OPS-04** Secrets (`SESSION_SECRET`, `DATA_ENC_KEY`, `EMAIL_HMAC_KEY`, `FILE_LINK_KEY`, SMTP credentials, Mongo passwords) are in an env file readable only by root on the server, never in git or in images. The encryption keys are also stored off the server (a password manager or sealed envelope), because losing them makes encrypted emails, phones and messages unreadable.
- **OPS-05** Containers restart automatically. A health check uses `/api/health`.

### Deploys
- **OPS-06** CI (GitHub Actions) runs lint, tests and build on every pull request. A merge to `main` builds images. Deploying to the server is a manual, one-command step (`docker compose pull && docker compose up -d`) run outside teaching hours (07:00–18:00 Sunday–Thursday is protected).
- **OPS-07** Database migrations (index changes, data fixes) are scripts in `server/migrations/`, run once and recorded in a `migrations` collection.

### Backups
- **OPS-08** A daily full backup (`mongodump --oplog`, including GridFS) is taken at 02:30 and copied off the server (for example to another machine or cloud storage), encrypted. Daily backups are kept for 30 days.
- **OPS-09** Point-in-time recovery for 7 days: continuous oplog archiving (or MongoDB Atlas if chosen). RPO is 24 hours without it, and under 15 minutes with it. RTO is 4 hours.
- **OPS-10** A restore is tested once each semester into a scratch environment, and the result is recorded in `docs/restore-log.md`.

### Monitoring
- **OPS-11** An external uptime check calls `/api/health` every minute and alerts the developers (email or chat) after 2 failures.
- **OPS-12** pino logs go to Docker's log driver with rotation (14 days). Errors (level ≥ 50) are counted, and an alert is sent if more than 20 occur in 5 minutes.
- **OPS-13** Failed Agenda jobs and a ClamAV scanner that is down are reported in a daily operations email to the developers.

### Performance check
- **OPS-14** Before each release, a load test (k6 or Artillery, run from a developer machine) simulates 2,000 users signing in and opening the dashboard within 5 minutes, plus 100 requests per second sustained. It must show: dashboard and routine p95 < 300 ms server time, free-room view p95 < 500 ms, chat delivery p95 < 2 s (R3), and no errors.

### Email setup
- **OPS-15** The sender domain has SPF, DKIM and DMARC records for the chosen provider. A test email to a real `@baiust.ac.bd` mailbox reaches the inbox, not spam (PRD Open question 1).

### Launch checklist (R1)
- **OPS-16** Before 4 Apr 2027: two super admins exist; every launching department has an admin, rooms, a published routine and CRs for all sections; email delivery is confirmed; a backup and a test restore have succeeded; the uptime check is on; and the load test has passed.

## Data

- `migrations`: name (unique), ran_at.

## Acceptance tests

- From outside the server, port 27017 isn't reachable.
- The app's MongoDB user can't update or delete in `audit_log`.
- `curl http://…` redirects to HTTPS, and the response has an HSTS header.
- A restore from last night's backup into a scratch server brings up a working app (semester test).
- Stopping `mongo` triggers the uptime alert within 2 minutes.
- The load test passes the thresholds in OPS-14.

## Decisions and open questions

- **Decision:** one VPS or university VM with Docker Compose, as in `tech-stack.md`. MongoDB Atlas stays an alternative, which would give point-in-time recovery without self-managed oplog archiving.
- **Open (PRD Open question 5):** university server or rented VPS, and who pays for email and storage.
- **Open:** where off-server backups are stored.

## Tasks

- [ ] Dockerfiles (server, client build), `docker-compose.yml`, Caddyfile
- [ ] Mongo replica set init script + users and the audit-log role
- [ ] ClamAV container + health check
- [ ] Env file template + key backup procedure
- [ ] CI image build + deploy instructions
- [ ] Migration runner
- [ ] Backup script + off-site copy + retention; restore runbook
- [ ] Uptime check, error alerting, daily ops email
- [ ] Load test scripts
- [ ] Email DNS records + inbox test
- [ ] Launch checklist document
