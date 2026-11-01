# 15: Transactional email

R1 · Status: Draft · Depends on: 00 (built alongside 01 onwards) · PRD: Authentication & onboarding (Required university email: emails, Batching, Link and code lifetimes), Admin dashboard and controls (Emails to admins), Non-functional requirements (Background jobs) · Diagrams: 03-system-context

## Goal

The system sends the emails the PRD lists, reliably, from one sender, through a queue with retries. Routine-change emails are batched so nobody gets one email per changed slot. Bouncing addresses are noticed. Admins get a twice-daily digest of waiting items.

## Scope

**In:** the email catalogue and templates, sending through the queue, batching, digests, bounce handling, the immediate super-admin alert, email preferences (there are none: students can't turn them off).

**Out:** in-app notifications (later release), announcement emails (later release). Chat messages are never emailed.

## Requirements

### Sending
- **EML-01** Every email goes through `mail.enqueue` → Agenda job `email.send` → Nodemailer (SMTP provider). Failed sends retry with backoff (5 tries over about 2 hours), and permanent failures are logged and kept as failed jobs.
- **EML-02** All emails come from `MAIL_FROM` (one system sender on a university-approved domain). SPF, DKIM and DMARC are set up for it (spec 23 checklist).
- **EML-03** Each email has a text and an HTML version rendered from a template and the i18n file, includes the app link, and never includes another user's email or phone.
- **EML-04** `dedupe_key`: an email with the same key enqueued again within 24 hours is dropped (prevents double sends from job retries).
- **EML-05** Addresses are decrypted only inside the send job, never stored in job data. Jobs carry `user_id` and template data only.

### Catalogue (R1)

| Template | To | Sent when | Spec |
|---|---|---|---|
| `verify_email` | new account | sign-up, resend | 01 |
| `already_registered` | existing account | sign-up with a used email | 01 |
| `reset_password` | account | forgot password, admin reset | 01, 03 |
| `password_changed` | account | password changed or reset | 01 |
| `failed_logins` | account | 10 failed sign-ins in an hour | 01 |
| `second_step_code` | admin | emailed code requested | 01 |
| `email_change_confirm` / `email_changed_notice` | new / old address | email change | 02 |
| `teacher_approved` / `teacher_rejected` | teacher | registration decided | 06 |
| `role_assigned` / `role_removed` | student | CR/DCR change | 09 |
| `join_accepted` / `join_rejected` | student | join request decided | 10 |
| `group_changed` | student | group changed | 10 |
| `uv_id_conflict` | dept admins | taken ID or auto-rejected duplicates | 10 |
| `semester_update_reminder` | unconfirmed student | day 0, 7, 14; CR/DCR reminder | 14, 17 |
| `routine_changed` | affected students and teachers | import publish or edits (batched) | 07, 08 |
| `class_cancelled` / `class_restored` | affected students and teachers | single-class cancellation | 11 |
| `admin_digest` | admins with waiting items | 08:00 and 17:00 | this spec |
| `department_without_admin` | super admins | a department loses its last admin | 03 |
| `room_request_result`, `booking_cancelled`, `request_expired` | requester and affected students | R2 | 19 |

### Batching
- **EML-06** Routine-change emails are combined per person: one email per person per import publish, and for hand edits at most one per person per hour. An edit adds the person to a pending batch (`email_batch` keyed by user + `routine_changed`) that is flushed by a job one hour after the first change. The email lists the changed days and classes in short form.
- **EML-07** Routine-change emails are sent only for the **current** semester.

### Admin digest
- **EML-08** At 08:00 and 17:00 institution time, each admin with at least one waiting item in their scope gets one digest: room requests (R2, sorted by decision cutoff), pending teacher registrations, escalated ID claims, open CR/DCR flags and open appeals. No digest is sent when nothing is waiting.

### Bounces
- **EML-09** A permanent bounce (reported by the provider's webhook, or an SMTP 5xx on send) sets `user.email_bouncing = true`. The user is asked to update their email at next sign-in (spec 02 PRF-06), and admins see "bouncing" (never the address) in user lists.
- **EML-10** No more emails are sent to a bouncing address except `email_change_confirm` (which goes to the new address).

### Development
- **EML-11** In development and test, emails go to the log and an in-memory outbox (spec 00 FND-24). A dev page `/dev/outbox` (development only) lists them, so links can be clicked without a mail server.

## Permissions

Not user-facing, except the bounce webhook, which is authenticated with a shared secret from the provider.

## Data

- `email_batch`: user_id, kind, items[], first_at, flush_job_id. Unique `{ user_id, kind }`.
- `email_dedupe`: key (unique), at (TTL 24 h).

## API

| Method and path | Who | Success | Errors |
|---|---|---|---|
| `POST /api/webhooks/email-bounce` | provider (shared secret) | 204 | `FORBIDDEN` |
| `GET /dev/outbox` | development only | HTML list | n/a |

## Jobs and events

- `email.send`, `email.flush_batch`, `email.admin_digest` (cron `0 8,17 * * *` in Asia/Dhaka).

## Acceptance tests

- EML-01: a transport failure is retried, and success on the 3rd try sends exactly one email.
- EML-04: the same `dedupe_key` enqueued twice sends one email.
- EML-05: the Agenda job document contains no email address.
- EML-06: three hand edits within an hour affecting a student → one `routine_changed` email after the hour.
- EML-07: edits to a draft semester send nothing.
- EML-08: an admin with nothing waiting gets no digest. A CSE admin's digest never lists EEE items.
- EML-09: a bounce marks the user, and the next sign-in returns `email_action_required: true`.
- No template renders another user's email or phone (snapshot test of every template with fake data).

## Decisions and open questions

- **Decision:** bounce detection through the provider's webhook (Brevo and SES both offer one) plus SMTP 5xx errors.
- **Open (PRD Open question 1):** which provider, sender address and domain, and whether university mail accepts it without marking it as spam. Must be settled before launch.

## Tasks

- [ ] Template renderer + all R1 templates (text + HTML) + snapshot tests
- [ ] `email.send` job with decrypt-at-send, dedupe, retry, bounce on 5xx
- [ ] Batching (`email_batch`, flush job)
- [ ] Admin digest job (scoped queries per admin)
- [ ] Bounce webhook
- [ ] Dev outbox page
- [ ] Tests
