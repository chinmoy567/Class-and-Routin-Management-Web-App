# 22: Chat safety and retention

R3 · Status: Draft · Depends on: 20 · PRD: Chat (Safety F2b, Privacy and retention), Core features (F2b), Admin dashboard and controls (Private chats) · Diagrams: 27-activity-chat-moderation

## Goal

Three light safety tools (block, report, chat suspension) and the retention rules that permanently delete old messages and files, while admins still never read private conversations except the small window around a reported message.

## Scope

**In:** blocking, reporting messages and people, the admin report view, chat suspension, retention and permanent deletion jobs.

**Out:** everything else in chat (specs 20, 21).

## Requirements

### Block
- **SAF-01** A user can block another user. The blocked user can't send them one-to-one messages (`403 BLOCKED`, with a neutral message that doesn't say they are blocked). The blocker can unblock at any time.
- **SAF-02** A user can't block an admin (`CANNOT_BLOCK_ADMIN`). Blocking doesn't affect section groups, announcements or system notices.
- **SAF-03** Blocked users are hidden from the blocker's people search, and the blocker is hidden from theirs.

### Report
- **SAF-04** A user can report a message (from a conversation they're in) or a person, with a reason category (`harassment`, `spam`, `inappropriate`, `impersonation`, `other`) and an optional note (up to 500 characters). Limited to 10 reports per day per user.
- **SAF-05** A report goes to the admins of the **reported person's** department (for a teacher, the department they're linked to; for a student, their section's department), or to super admins if the reported person is an admin.
- **SAF-06** For a reported message, the admin sees only that message and up to 5 messages before and after it in the same conversation, with senders' names. Nothing else of the conversation, ever. For a reported person (no message), the admin sees the reason and note only.
- **SAF-07** Every opening of the report view is audited (`chat.report_view`, with admin, report and time).
- **SAF-08** The admin closes a report with an outcome (`no_action`, `warned`, `suspended`, `message_removed`) and an optional note. The reporter is told it was reviewed (not the outcome details).
- **SAF-09** A reported message, and the messages shown around it, are kept (not erased by retention or delete-for-everyone erasure) until the report is closed plus 90 days.

### Chat suspension
- **SAF-10** An admin of the user's department can suspend them from **sending** messages for a set time (1 hour to 90 days) with a reason. The user is told, can still read chats and use the rest of the app, and gets `403 CHAT_SUSPENDED` with the end time when sending. The admin can lift it early. Suspensions are audited.
- **SAF-11** A user can't be suspended by an admin of another department. Super admins can suspend anyone except themselves.

### Retention
- **SAF-12** Messages and files older than 12 months (by send date) are deleted permanently by a nightly job (02:00 institution time), except those held by SAF-09.
- **SAF-13** A message deleted by its sender (or a group owner) is removed from view at once and its body and file permanently erased 30 days later, except those held by SAF-09.
- **SAF-14** The jobs work in batches (1,000 per batch) and are idempotent. Conversations with no messages left keep their record (so 1:1 history can continue).

## Permissions

| Action | Who |
|---|---|
| Block / unblock | any chat-enabled user (not targeting an admin) |
| Report | any chat-enabled user |
| View and close reports | admins of the reported person's dept; super admins for admin targets |
| Suspend / lift | admin of the user's dept; super admin |

## Data

- `block`: blocker_id, blocked_id, created_at. Unique `{ blocker_id, blocked_id }`.
- `report`: reporter_id, target_user_id, message_id?, conversation_id?, category, note?, department_id? (routing), to_super_admins (bool), status (`open` | `closed`), outcome?, outcome_note?, closed_by?, closed_at?, hold_until?, created_at.
- `chat_suspension`: user_id, until, reason, by, lifted_at?, lifted_by?. Index `{ user_id, until }`. `user.chat_suspended_until` is kept in sync for fast checks.
- `message.hold_until?` set by SAF-09.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/chat/blocks` | user | user_id | 201 | `CANNOT_BLOCK_ADMIN`, `CONFLICT` |
| `DELETE /api/chat/blocks/:userId` | user | none | 204 | none |
| `GET /api/chat/blocks` | user | none | blocked list | none |
| `POST /api/chat/reports` | user | target_user_id, message_id?, category, note? | 201 | `RATE_LIMITED`, `NOT_FOUND` |
| `GET /api/admin/chat/reports?status=` | routed admins | none | list (no message text) | none |
| `GET /api/admin/chat/reports/:id` | routed admins | none | report + context window (audited) | `NOT_FOUND` |
| `POST /api/admin/chat/reports/:id/close` | routed admins | outcome, note? | 200 | `ALREADY_DECIDED` |
| `POST /api/admin/chat/suspensions` | admin of dept | user_id, hours, reason | 201 | `FORBIDDEN` |
| `POST /api/admin/chat/suspensions/:id/lift` | admin of dept | none | 200 | none |

## Jobs and events

- `chat.retention` nightly at 02:00 (12-month purge, 30-day erase of deleted messages, release of expired holds).
- Emails: none (in-app notices to the user only; reports never trigger emails to the reported person).

## Screens

Block/unblock and Report actions on messages and profiles, Blocked users list in settings, admin Reports page (list, context view with "audited" notice, close dialog), Suspend dialog on the admin student/teacher page, a suspension banner in chat.

## Acceptance tests

- SAF-01: a blocked user's message → `BLOCKED`. After unblock → delivered.
- SAF-02: blocking an admin → `CANNOT_BLOCK_ADMIN`.
- SAF-06: the report view returns at most 11 messages, all from that conversation, centred on the reported one.
- SAF-07: each view writes one audit entry.
- SAF-09: a reported message deleted by its sender still exists 31 days later while the report is open, and is erased 90 days after closing.
- SAF-10: a suspended user can read but sending → `CHAT_SUSPENDED`, and their room requests and routine still work.
- SAF-12: a message 12 months and 1 day old is gone after the nightly job. One 11 months old remains.
- A CSE admin opening a report routed to EEE → `404`.

## Decisions and open questions

- **Decision:** the context window is 5 messages before and after (the PRD says "a few").
- **Decision:** a report's routing department is fixed when it's created.

## Tasks

- [ ] `block`, `report`, `chat_suspension` models
- [ ] Block checks wired into send and search (spec 20)
- [ ] Report create + routing + admin list/view (audited) + close + holds
- [ ] Suspension create/lift + check in send
- [ ] Retention job (batches, holds)
- [ ] Screens
- [ ] Tests
