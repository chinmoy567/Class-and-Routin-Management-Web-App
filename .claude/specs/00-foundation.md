# 00: Foundation

R1 · Status: Draft · Depends on: none · PRD: Non-functional requirements, Technical approach · Diagrams: 04-architecture, 23-deployment

## Goal

A running skeleton that every later spec builds on: the repo layout, server and client apps, shared libraries, the `can()` policy engine, the audit log, background jobs, the mail queue, real-time plumbing and the test setup. No product features.

## Scope

**In:** repo and tooling, configuration, database connection and transactions, errors and validation, time helpers, encryption helpers, policy engine, audit module, Agenda jobs, mail queue and transport, Socket.IO server, security middleware, logging, client shell, i18n, test harness, seed script, CI.

**Out:** any feature screen or endpoint other than `/api/health`. Deployment is covered by spec 23.

## Requirements

### Repo and tooling
- **FND-01** The repo has three npm workspaces: `client/` (React + Vite), `server/` (Express) and `shared/` (Zod schemas, enums and error codes used by both). All are JavaScript ES modules. No TypeScript.
- **FND-02** ESLint and Prettier run from the root. `npm run lint`, `npm test` and `npm run build` work from the root and from each workspace.
- **FND-03** GitHub Actions runs lint, tests and build on every push and pull request.

### Configuration
- **FND-04** On startup the server reads its configuration from environment variables and checks it with Zod. If a required value is missing it refuses to start and names the missing variable. Required: `MONGO_URL`, `SESSION_SECRET`, `DATA_ENC_KEY` (32 bytes, base64), `EMAIL_HMAC_KEY`, `FILE_LINK_KEY`, `SMTP_*`, `MAIL_FROM`, `APP_URL`, `CLAMAV_HOST`.
- **FND-05** `.env.example` lists every variable with a comment. Real `.env` files are git-ignored.

### Database
- **FND-06** The server connects to MongoDB as a replica set and refuses to start if transactions are unavailable.
- **FND-07** `withTransaction(fn)` is provided as in the mongo-patterns skill, with snapshot read concern, majority write, and automatic retry on transient errors.
- **FND-08** In development and test, `syncIndexes()` runs for every model on startup.

### Errors and validation
- **FND-09** `AppError(status, code, message, fields?)` and one error middleware produce `{ error: { code, message, fields? } }`. Unknown errors return `500 INTERNAL` with no details, and the full error is logged.
- **FND-10** `validate({ body, query, params })` parses input with Zod, replaces it with the parsed values, and returns `400 VALIDATION_ERROR` with per-field messages.
- **FND-11** Error codes live in `shared/errors.js` as constants. The client uses the same constants to choose a translated message.

### Time
- **FND-12** `server/src/lib/time.js` reads "now" from an injectable clock (`clock.now()`) so tests can fix the time. It provides: `institutionNow()`, `toInstitutionDate(instant) → 'YYYY-MM-DD'`, `minutesOfDay(instant)`, `instantFrom(date, minutes)`, `weekStart(date)` (the Sunday), `weekdayOf(date)`, and `addDays`. All use `Asia/Dhaka` through date-fns-tz. Nothing hard-codes `+6`.
- **FND-13** A lint rule or test forbids `new Date()` and `Date.now()` outside `lib/time.js` and test files.

### Encryption
- **FND-14** `lib/crypto.js` provides `encrypt(text)` and `decrypt(blob)` (AES-256-GCM with a random IV, stored as base64 `iv.tag.data`) using `DATA_ENC_KEY`, `emailHmac(email)` (HMAC-SHA256 of the trimmed, lower-cased email using `EMAIL_HMAC_KEY`), `randomToken()` (32 random bytes, base64url) and `hashToken(token)` (SHA-256, used to store one-time tokens).

### Authorization
- **FND-15** `server/src/policy/can.js` exports `can(user, action, resource)` and `assertCan(...)`. `assertCan` throws `403 FORBIDDEN`, or `404 NOT_FOUND` when the policy marks that action as hiding existence. Policies are plain synchronous functions registered by each module, keyed `<resource>.<verb>`.
- **FND-16** A request's `user` object carries `_id`, `kind`, `state`, `chat_suspended_until`, and `roles: [{ role, department_id?, section_id?, semester_id? }]` (only roles in effect). It is loaded once per request after authentication.
- **FND-17** Helpers: `hasRole(user, role, scope?)`, `isAdminOf(user, departmentId)` (true for a super admin or a department admin of that department) and `stateIn(user, [...])`.
- **FND-18** Calling an unregistered action throws in development and test, and denies in production.

### Audit
- **FND-19** The `audit` module provides `record({ actor, action, scope_department_id, target: { type, id }, old_value, new_value, session })` and `list(filter)`. `record` must be called with a session when the action is in a transaction.
- **FND-20** `audit_log` is append-only: the model forbids update and delete (mongo-patterns §7), and the production database user has only `find` and `insert` on it (spec 23).

### Background jobs
- **FND-21** Agenda runs on the same MongoDB, in the server process. Each module registers its jobs from `<module>.jobs.js`. Failed jobs retry with exponential backoff (up to 5 tries). A job that still fails stays in the collection, marked failed, and is logged at `error` level.
- **FND-22** Jobs are idempotent: running a job twice changes nothing the second time.

### Mail
- **FND-23** `mail.enqueue({ to_user_id | to_address, template, data, dedupe_key? })` adds an `email.send` job. Templates are in `server/src/modules/notifications/templates/`, with text and HTML versions, and are rendered from the i18n file. The catalogue, batching and bounces are covered by spec 15.
- **FND-24** In development and test the transport writes emails to a log and an in-memory outbox (tests can read it) instead of sending.

### Real-time
- **FND-25** A Socket.IO server shares the Express session. An unauthenticated socket is rejected. Each socket joins `user:<id>`, plus rooms the feature specs add (for example `section:<id>`).
- **FND-26** `events.emitAfterCommit(room, event, payload)` sends only after the surrounding transaction has committed. Payloads carry ids and the event name only, never personal data.

### Security middleware
- **FND-27** helmet (with HSTS in production), JSON body limit 1 MB, `trust proxy` set for Caddy, and CORS off (the client is served from the same origin).
- **FND-28** CSRF: the session holds a random token, `GET /api/auth/csrf` returns it, and every non-GET request must send it in `X-CSRF-Token`. A mismatch returns `403 CSRF_FAILED`.
- **FND-29** A general rate limit of 300 requests per minute per IP using express-rate-limit with a MongoDB store. Stricter limits are added by feature specs.

### Logging
- **FND-30** pino with request ids. Redaction of `password`, `token`, `code`, `email`, `phone`, `cookie` and `authorization` paths. Request logs never include bodies.

### Client
- **FND-31** A Vite React app with Tailwind, shadcn/ui initialised, React Router, a TanStack Query provider, `lib/api.js` (credentials, CSRF header, `ApiError`), `lib/query-keys.js`, `lib/socket.js`, `lib/time.js` (server-time offset) and an `AppShell` with a mobile-first navigation. Layout follows the ui-conventions skill.
- **FND-32** i18n: every visible string comes from `client/src/i18n/en.json` through `t(key, vars)`. Server email text comes from `server/src/i18n/en.json`.
- **FND-33** vite-plugin-pwa makes the app installable (manifest, icons, offline shell). API responses are never cached by the service worker.

### Tests
- **FND-34** A server test harness that starts one `MongoMemoryReplSet` per test run, clears collections between test files, fixes the clock, and provides factories (`makeDepartment`, `makeUser({ kind, state, roles })`, `makeSemester`, `makeSection`…) and `loginAs(user)` returning a Supertest agent with the session and CSRF token set.
- **FND-35** Client tests use Vitest + Testing Library (jsdom). Playwright is installed with one smoke test that opens the app.

### Seed and health
- **FND-36** `npm run seed:super-admin -- --email <e> --name <n>` creates the first super admin (staff account, `active`, email verified, `super_admin` role) and the allowed domain `baiust.ac.bd`. It refuses to run if a super admin already exists. The user sets the password through a one-time reset link that the script prints.
- **FND-37** `GET /api/health` returns `{ data: { ok: true, db: 'up' } }`, or `503` if MongoDB is down.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Input failed Zod validation (`fields` lists the problems) |
| `UNAUTHENTICATED` | 401 | Not signed in, or session expired |
| `SECOND_STEP_REQUIRED` | 401 | Admin signed in with a password but hasn't passed the second step |
| `CSRF_FAILED` | 403 | Missing or wrong CSRF token |
| `FORBIDDEN` | 403 | Signed in but not allowed |
| `STATE_NOT_ALLOWED` | 403 | The account state doesn't allow this (`fields.state` gives the state) |
| `NOT_FOUND` | 404 | Doesn't exist, or the caller may not know it exists |
| `ALREADY_DECIDED` | 409 | First action wins: someone already decided |
| `CONFLICT` | 409 | Breaks a uniqueness rule (`message` says which) |
| `RATE_LIMITED` | 429 | Too many requests (`Retry-After` header set) |
| `INTERNAL` | 500 | Unexpected error |

Feature specs add their own codes (for example `REQUEST_LIMIT`) and list them in their API section.

## Data

- `audit_log`: actor_id, actor_roles (snapshot), action, scope_department_id?, target_type, target_id, old_value?, new_value?, at, request_id. Indexes: `{ at: -1 }`, `{ scope_department_id: 1, at: -1 }`, `{ target_type: 1, target_id: 1, at: -1 }`.
- `agendaJobs`: managed by Agenda.
- `sessions`: managed by connect-mongo (spec 01 sets its options).
- `rate_limits`: managed by the rate-limit store.

## Acceptance tests

- Given a missing `DATA_ENC_KEY`, when the server starts, it exits with an error naming the variable.
- Given MongoDB running without a replica set, the server refuses to start.
- An unknown thrown error returns `500 INTERNAL` with no stack trace in the body.
- A POST without a CSRF token returns `403 CSRF_FAILED`.
- `audit_log.updateOne(...)` and `deleteMany(...)` throw.
- `can()` with an unregistered action throws in the test environment.
- `encrypt` then `decrypt` returns the original text, and two encryptions of the same text differ.
- With the clock fixed at 2026-11-10T17:34:00Z, `toInstitutionDate` returns `2026-11-10` and `minutesOfDay` returns 1414 (23:34). At 18:05Z it returns `2026-11-11` (after midnight in Dhaka).
- `weekStart('2026-11-09')` (a Monday) returns `2026-11-08` (the Sunday).
- A job that throws is retried, and after 5 failures is marked failed.
- The seed script refuses to run twice.
- An emitted event inside a transaction that aborts is never sent.

## Decisions and open questions

- **Decision:** a `shared/` workspace for Zod schemas and constants. `tech-stack.md` wants shared schemas, and a third package is the simplest way.
- **Decision:** i18n uses a small in-house `t()` helper rather than react-i18next, to avoid a library that isn't in `tech-stack.md`. Switch if Bangla support needs plural rules the helper can't handle.
- **Decision:** CSRF is done in-house (a token in the session plus a header). No extra library.
- **Decision:** Agenda runs inside the API process. That's fine for one server. Move it to a separate worker process if jobs slow down requests.
- **Open:** the rate-limit MongoDB store library (`rate-limit-mongo` or similar) isn't named in `tech-stack.md`. Confirm the choice.

## Tasks

- [ ] Root `package.json` with workspaces, ESLint, Prettier, `.editorconfig`, `.gitignore`, `.env.example`
- [ ] `shared/`: `errors.js`, `enums.js` (states, roles, kinds, event names), schema folder
- [ ] Server: config loader (FND-04), pino logger, Express app, error middleware, `validate()`
- [ ] Server: DB connect + replica-set check, `withTransaction`, `syncIndexes` on startup
- [ ] Server: `lib/time.js` with an injectable clock, plus the lint rule against direct `Date` use
- [ ] Server: `lib/crypto.js`
- [ ] Server: policy engine `can` / `assertCan` / helpers
- [ ] Server: `audit` module (model with append-only guards, `record`, `list`)
- [ ] Server: Agenda setup, job registry, retry policy
- [ ] Server: mail queue, transport, template renderer, dev outbox
- [ ] Server: Socket.IO with session auth, `emitAfterCommit`
- [ ] Server: helmet, CSRF, base rate limit, `/api/health`
- [ ] Server: seed script for the first super admin
- [ ] Server: test harness (replica set, factories, `loginAs`, fixed clock)
- [ ] Client: Vite + Tailwind + shadcn init, router, query client, `api.js`, `socket.js`, `time.js`, i18n, `AppShell`, PWA
- [ ] Client: Vitest setup, one Playwright smoke test
- [ ] CI workflow
- [ ] Fill in the **Commands** section of `.claude/CLAUDE.md`
