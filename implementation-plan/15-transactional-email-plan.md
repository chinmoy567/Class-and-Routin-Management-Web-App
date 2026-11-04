# Plan: Spec 15 — Transactional email

Spec file: `.claude/specs/15-transactional-email.md`. Builds on the queue and templates that exist from specs 00 and 01 (`server/src/modules/notifications/`).

## Goal
Every PRD email goes through `enqueue` → `email.send` → Nodemailer, with retries over about 2 hours, a 24-hour dedupe, no address in job data, batched routine-change emails, a twice-daily admin digest, bounce handling, and a dev outbox page.

## Gap check against the code today
- `enqueue` puts plaintext `to_address` into job data (breaks EML-05 for sign-up, reset and email change).
- Retries back off 1 s, 2 s, 4 s, 8 s (about 15 s in total). EML-01 needs about 2 hours.
- Dedupe lasts only while the Agenda job exists (EML-04 needs 24 h).
- Routine-change emails are one per publish, or one per hour key, with no batch (EML-06).
- `class_cancelled` and `class_cancellation_undone` are used by calendar but have no template, so those sends would fail. The catalogue name for the undo email is `class_restored`.
- Missing catalogue templates: `admin_digest`, `class_cancelled`, `class_restored`, `room_request_result`, `booking_cancelled`, `request_expired`. The last three belong to spec 19, but spec 15 owns the catalogue.
- No digest, no bounce webhook, no bounce skip (EML-10), no `/dev/outbox`.

## Decisions (tell me if you disagree)
- **D1 Retry.** `email.send` uses 5 attempts with exponential backoff and a base of 8 minutes (8, 16, 32, 64 min: about 2 h in total). `lib/jobs.js` `define()` takes a per-job `retry` option. Other jobs keep their defaults.
- **D2 Addresses not yet tied to a user.** Sign-up, reset and email change need an address before a user record can be looked up. The address is encrypted with `encrypt()` at enqueue and decrypted inside the job, so the job holds ciphertext and never a plaintext address. This is the one departure from "user_id and template data only", and those flows need it.
- **D3 Dedupe.** An `email_dedupe` collection with a unique `key` and a TTL field `at` (24 h). `enqueue` inserts first; a duplicate key drops the email (EML-04).
- **D4 Bounces.** `sendEmailJob` skips a bouncing recipient (EML-10) for every template except `email_change_confirm`. An SMTP 5xx sets `email_bouncing` and is not retried, because it is permanent. Other errors retry.
- **D5 Batching.** `email_batch` (unique `{user_id, kind}`) holds `items[]`, `first_at` and `flush_scheduled`. A routine import publish flushes its batch at once (one email per person per publish). A hand edit schedules one flush at `first_at + 1 h`; `flush_scheduled` stops a second schedule. (Departure: a flag instead of `flush_job_id`.) The flush enqueues one `routine_changed` email with dedupe key `batch:<batch id>`, then deletes the batch. Edits to a draft semester send nothing (EML-07).
- **D6 Batch item content.** Publish and edit know sections, not slots. Each item is a section summary: its label, the days it meets and its course codes, read from the routine module's own collections through an exported helper.
- **D7 Template names.** Calendar's undo email is renamed `class_restored` (catalogue). `no_active_admin` stays the code name for `department_without_admin`. Templates for spec 19 (`room_request_result`, `booking_cancelled`, `request_expired`) are added now and are unused until spec 19.
- **D8 Digest.** A provider registry (`registerDigestProvider({ key, label, count(scope), list(scope) })`) lives in notifications. Teachers (pending registrations) and join (escalated join requests) register providers. Room requests (spec 19), CR/DCR flags (spec 17) and appeals (spec 22) are not built, so they have no provider yet. The digest email lists labels and counts only, never names, emails or phones. A super admin sees all departments; a department admin sees only their own.
- **D9 Bounce webhook.** `POST /api/webhooks/email-bounce`, mounted before CSRF because providers cannot send a CSRF token. The shared secret is in header `x-email-webhook-secret`, compared in constant time with `EMAIL_WEBHOOK_SECRET`. If the secret is unset, every call gets 403. Body `{ email, type: 'bounce' | 'complaint' }`; only a `bounce` sets the flag. Provider payloads differ, so a per-provider adapter comes later.
- **D10 Dev outbox.** `GET /dev/outbox` is mounted only when `NODE_ENV === 'development'`. It lists subject, recipient and text, all escaped.
- **D11 Provider.** PRD open question 1 (provider and sender domain) is still open. The code is provider-neutral Nodemailer over SMTP, so it does not block the build. SPF, DKIM and DMARC are spec 23.

## Files
Server (`server/src/modules/notifications/` unless stated)
- `email.model.js` (new): `EmailBatch` and `EmailDedupe` with schema indexes.
- `mail.service.js`: `enqueue` (encrypted `to_address`, dedupe) and `sendEmailJob` (decrypt, bounce skip, 5xx → bounce, render, send).
- `mail.jobs.js`: `email.send` retry option, `email.flush_batch`, `email.admin_digest`.
- `batch.service.js` (new): `addToBatch`, `flushBatch`.
- `digest.service.js` (new): `registerDigestProvider`, `buildDigest(scope)`, `sendAdminDigests()`.
- `bounce.service.js` (new): `recordBounce({ email, type })`.
- `notifications.routes.js` (new): bounce webhook router.
- `dev.routes.js` (new): `/dev/outbox`, development only.
- `templates/index.js` and `server/src/i18n/en.json`: missing templates and `admin_digest`.
- `index.js`: exports.
- `lib/jobs.js`: per-job retry option. `config.js`: optional `EMAIL_WEBHOOK_SECRET`.
- `app.js`: webhook mount before CSRF; dev outbox mount in development. `server.js`: `email.admin_digest` at `0 8,17 * * *` in Asia/Dhaka.
- `auth/`: exports `markEmailBouncing(userId)` and `findUserIdByEmail(email)` (via `emailHmac`).
- `routine/publish.service.js` and `routine/slot.service.js`: `notifyRoutineChange({ semester, sectionIds, teacherIds, flushNow })` uses `addToBatch`; add a `describeSections` helper exported from the routine index.
- `calendar/calendar.service.js`: `class_restored` rename.
- `teachers/index.js` and `join/index.js`: register digest providers.

Client: none. `/dev/outbox` is server-rendered HTML.

## Requirements → tests
1. EML-01: a transport error on tries 1 and 2, success on try 3 → exactly one email. Retry delays add up to about 2 h.
2. EML-02: every email's `from` is `MAIL_FROM`.
3. EML-03: text and HTML for every template; snapshot test of every template with fake data; no `@` or phone-like string in any output.
4. EML-04: the same `dedupe_key` twice within 24 h → one job. After the row's TTL has passed, a new one is accepted.
5. EML-05: the job document has no plaintext address, for `to_user_id` and for `to_address`.
6. EML-06: three hand edits in an hour → one `routine_changed` email, sent after the hour. An import publish → one email straight away.
7. EML-07: edits to a draft semester send nothing.
8. EML-08: no waiting items → no digest. A CSE admin's digest never lists EEE items. Labels and counts only.
9. EML-09: the bounce webhook refuses a wrong secret (403) and accepts the right one (204) and sets `email_bouncing`. The next sign-in returns `email_action_required: true`. An SMTP 5xx marks the bounce and does not retry.
10. EML-10: a bouncing address gets no email except `email_change_confirm`.
11. EML-11: `/dev/outbox` lists sent emails in development and is not mounted in production.
12. Concurrency: two simultaneous `addToBatch` calls for one user leave one batch document; two simultaneous dedupe inserts create one job.
13. Calendar cancellation and restore emails render (`class_cancelled`, `class_restored`).

Verification: `npm test -w @crm/server`, `npm run lint`, `npm run build`, then a report under `test-results/`.

## Out of scope
Provider choice and DNS (spec 23), in-app notifications (F11, later), announcements (later), digest sources for specs 17, 19 and 22, the admin screen for bouncing users, and Playwright.

## Departures found while verifying
- **Flush tied to one batch.** The flush job carries `batch_id`, not user and kind. A flush booked for an earlier batch can no longer send a later batch early. A failed flush puts its items back under the same id so the retried job finds them.
- **Sign-in carries the bounce flag.** `POST /api/auth/login` returns `email_action_required` next to `next`, as the spec's acceptance test names it. `GET /api/auth/me` still returns it too.
- **Deactivated and suspended admins get no digest.** The digest reads only admins whose account is `active`.
- **Cancellation emails keyed on the cancellation.** The key is the cancellation id, so a class cancelled, restored and cancelled again the same day is emailed each time.
- **After-commit steps are awaited.** `afterCommit` outside a transaction runs the step and logs a failure instead of throwing. Callers await it, so no email is still being queued after the response has gone out.
- **Template renamed to the catalogue name.** `no_active_admin` is now `department_without_admin`.
- **Placeholder guard.** A template with an unfilled `{placeholder}` throws in development and tests, and logs an error in production.
- **Still a departure:** `email_batch` keeps a `flush_scheduled` flag instead of storing `flush_job_id`. The flag has the same one-flush-per-batch effect.
