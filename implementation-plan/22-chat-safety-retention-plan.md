# Plan: Spec 22, Chat safety and retention

Spec: `.claude/specs/22-chat-safety-retention.md` (status Draft, depends on 20, now Done). On approval: set the spec to `Approved`/`In progress`, save this plan to `implementation-plan/22-chat-safety-retention-plan.md`, then build.

## Context

Anyone can message anyone, so the chat needs block, report and chat suspension, plus retention rules that permanently delete old messages and files. Admins must still never read private chats, except the reported message and 5 messages either side, and every such view is audited. None of the PRD's open questions blocks this spec.

## Decisions confirmed with the user

1. **Notices:** no new notification system. The reporter sees each of their reports as Open or Reviewed (no outcome) in a "My reports" list. A suspended user sees a banner in chat with the end time.
2. **Deleting a message:** it disappears from view at once, but the stored text is kept until the nightly job erases it 30 days later, unless a report holds it. This changes spec 20's `erase()` in `chat.messages.service.js`, which currently unsets `body_enc` on delete.
3. **Closing a report:** the outcome is recorded. `message_removed` also deletes the reported message for everyone. `suspended` records only; suspending uses the Suspend dialog (its own audit entry).
4. **Blocked users list:** page `/chat/blocked`, linked from the chat list.

My own decisions (override if you disagree):
- Blocking is one-way. The blocked user cannot send to the blocker; the blocker can still send. A blocked person can't be found in search and vice versa. `POST /api/chat/direct` by a blocked user returns `CHAT_NOT_ALLOWED` (neutral text).
- A held message is marked `hold_open: true` while its report is open. On close it gets `hold_until = closed_at + 90 days` and `hold_open: false`.
- Held messages are the reported one and the 5 before and 5 after it, fixed when the report is created.
- In the admin report view, deleted messages other than the reported one show "message deleted" with no text.
- A report routes to the target's department: teachers and staff use `user.department_id`, students use `departmentOfStudent` (enrolments module). Admin targets, or targets with no department, go to super admins.
- Blocking yourself, or suspending yourself, is refused (`VALIDATION_ERROR` / `FORBIDDEN`).
- The upload path (spec 21) gets the same suspension and block checks as text sends.

## Rules checklist

SAF-01 block refuses `BLOCKED` (neutral text), unblock any time. SAF-02 `CANNOT_BLOCK_ADMIN`, groups unaffected. SAF-03 search hides both ways. SAF-04 report categories, note up to 500, 10 per day. SAF-05 routing. SAF-06 context window of at most 11 messages, same conversation. SAF-07 `chat.report_view` audit on every open. SAF-08 close with outcome, `ALREADY_DECIDED`, reporter sees "reviewed". SAF-09 hold until closed plus 90 days. SAF-10 suspension 1 hour to 90 days, `CHAT_SUSPENDED` with end time, lift early, audited. SAF-11 other-department admin refused, super admin can't suspend self. SAF-12 12-month purge at 02:00 Asia/Dhaka. SAF-13 30-day erase. SAF-14 batches of 1,000, idempotent, conversation records stay. Plus the spec's acceptance tests (CSE admin opening an EEE report gets 404; SAF-10 suspended user's room requests and routine still work).

## Server (`server/src/modules/chat/`)

- `chat.model.js`: add `Block` (`block`, unique `{blocker_id, blocked_id}`), `Report` (`report`, fields per spec, with `department_id` for routing; indexes `{status, department_id, created_at}`, `{reporter_id, created_at}`, `{message_id}`), `ChatSuspension` (`chat_suspension`, index `{user_id, until}`). On `Message` add `hold_open` and `hold_until`, plus indexes for the jobs (`{created_at}`, `{deleted_at}` sparse).
- `chat.policy.js`: new actions `chat.block` (chat-enabled, target not an admin), `chat.report` (chat-enabled), `chat.review_report` (active admin of the report's department, or super admin for super-admin-routed reports; hidden as 404), `chat.suspend` (active admin of the target's department, or super admin; never self).
- New services: `chat.safety.service.js` (block, unblock, list, `isBlockedEitherWay`), `chat.report.service.js` (create with routing and holds, list, view with context and audit, close with conditional update), `chat.suspension.service.js` (suspend, lift, `assertNotSuspended`), `chat.retention.service.js` and `chat.retention.jobs.js` (job `chat.retention`).
- Wire-ins: `chat.messages.service.js` `sendMessage` (suspension then block then existing rules; new `erase()` rule), `chat.files.service.js` `uploadFile` (same checks), `chat.people.service.js` (hide blocked both ways), `chat.direct.service.js` (blocked opener refused), `chat.context.js` helpers, `chat.routes.js`, `chat.controller.js`, `chat.schemas.js`, `index.js` (export the new job registrar), `server/src/server.js` (schedule `every('0 2 * * *', 'chat.retention', {}, { timezone: 'Asia/Dhaka' })`).
- Audit entries through the existing `record()`: `chat.report_view`, `chat.report_closed`, `chat.suspended`, `chat.suspension_lifted`, `chat.message_removed_by_report`. No message text in audit or logs. Reads of other modules only through their `index.js` (`departmentOfStudent` from enrolments, `peopleById` from auth).

## API

As in the spec table, plus `GET /api/chat/reports/mine` (reporter's own reports, status only). Zod schemas for every body, query and param. Hours is an integer 1 to 2160. Close and lift use conditional `findOneAndUpdate` so the second concurrent action gets `ALREADY_DECIDED`. A duplicate block (unique index) returns `CONFLICT`. The daily report limit counts reports since the start of the Asia/Dhaka day; 11 parallel reports must store at most 10.

## Retention job (SAF-12 to SAF-14)

Three idempotent passes in batches of 1,000: purge messages older than 12 months that are not held (delete message and its GridFS file via `deleteChatFile`), erase text and file of messages deleted over 30 days ago that are not held (keep the tombstone with `deleted_at`), and clear expired `hold_until`. Conversations are never deleted. Logs counts only.

## Client (`client/src/`)

- `features/chat`: api, hooks and query keys for blocks, reports and suspension. Components `ReportDialog` (category, note up to 500), block/unblock button, `SuspensionBanner` (chat list and conversation, send form disabled, handles `CHAT_SUSPENDED` and `BLOCKED` errors), `MyReports` list. Add "Report" to `MessageBubble` for others' messages, and Block/Report on `PublicProfilePage`. Page `routes/BlockedUsersPage.jsx` at `/chat/blocked` with a link in `ChatListPage`.
- `features/admin` and `routes/admin/AdminReportsPage.jsx` at `/admin/reports`: list (Open/Closed), detail with the "this view is audited" notice and the context messages, close dialog. A Suspend dialog (hours, reason) and Lift on `AdminStudentsPage.jsx` and `TeachersPage.jsx`. Route and nav entry in `App.jsx` and `AppShell.jsx`.
- All text in `client/src/i18n/en.json`, labelled controls and `role="alert"` errors, layouts reviewed at 360 px. Chat screens stay behind `chat.app`.

## Tests (each named after its SAF id)

Server (Vitest, Supertest, in-memory replica set), new `chat.safety.test.js`, `chat.retention.test.js`: one or more tests per SAF-01 to SAF-14 and each acceptance line; every role (student, `claim_pending`, CR, teacher, department admin, other-department admin, super admin) tries another department's report, suspension and block and is refused; concurrency tests (parallel closes, parallel lifts, parallel blocks, 11 parallel reports); retention tests with the clock moved (12 months + 1 day gone, 11 months kept, deleted message gone at day 31, held message kept 31 days and erased 90 days after close, 2,500 messages in three batches, second run changes nothing); update the CHT-19 route scan to allow only the report view route, and the CHT-07 test if it checks storage. Client tests: report dialog, block flow, suspension banner, blocked list, admin reports page and suspend dialog.

## Build order

1. Models, indexes, policies, schemas. 2. Block (SAF-01 to 03) with send, search and open wiring + tests. 3. Suspension (SAF-10, 11) with send and upload wiring + tests. 4. Report create, routing, rate limit, holds (SAF-04, 05, 09) + tests. 5. Admin list, view, close, my reports (SAF-06 to 08) + tests. 6. Change `erase()`, retention job and schedule (SAF-12 to 14, SAF-09 timing) + tests. 7. Client chat screens. 8. Client admin screens. 9. Translations, accessibility, 360 px review. 10. Run lint, tests, build; tick the spec checklist and set the status.

## Out of scope

Deactivating an account from a report, emails or a notification centre (F11), announcements, an admin dashboard card for reports, load tests (spec 23). The uncommitted spec 21 edits in `chat.files.service.js` and its test stay as they are, except the small suspension and block check added to `uploadFile`.

## Verification

`npm test -w @crm/server`, `npm test -w @crm/client`, `npm run lint`, `npm run format:check`, `npm run build`, then a check of the plan's checklist against the passing tests.
