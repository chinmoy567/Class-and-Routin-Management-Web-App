# Plan: Spec 17 — CR/DCR dashboard

Spec: `.claude/specs/17-cr-dcr-dashboard.md` (R1, room-request parts in R2). Depends on 10 (join requests, built) and 12 (my routine and live status, code present).

## Goal

A dashboard for the CR and DCRs of one section in one semester, at `/cr/sections/:id`. It shows the roster with confirmation status, the unconfirmed students (with a once-a-day reminder), the join-request inbox (pending, rejected and escalated), the section's routine and live status (section and each group), the free-room view, and the flags raised to the admin. Actions: decide join requests, change a student's group, send reminders, raise flags. Access is checked on every request, so a removed role gets `404` at once.

## What already exists and is reused

- Join requests and decisions (spec 10): `GET /api/sections/:id/join-requests`, `POST /api/enrolments/:id/decision`, `PATCH /api/enrolments/:id/group`. Their `join.*` policies already allow the CR/DCR of the section and the department admin, and they already audit and email. No change to these endpoints.
- Routine (spec 12): `getMyRoutine` builds the day and week payload. It is refactored so a section and each group can use the same builder.
- `liveStatus` from `shared/liveStatus.js`, `LiveStatusCard`, `WeekGrid`, `DayList`, `useLiveStatus`, `useRoutineSocket`.
- Free rooms (spec 13): `FreeRoomsFinder` on the client, unchanged.
- Representatives (spec 09): `crDcrOf`, `lastSemesterMatch` (CRD-07), `isOpen`.
- Rollover (spec 14): `unconfirmedStudentIds` and the `semester_update_reminder` email template.
- Digest (spec 15): `registerDigestProvider`, for the open-flags count.
- `withTransaction`, `afterCommit`, `record` (audit), `enqueue` (mail).

## Rules and acceptance checklist

1. CRD-DSH-01 Only an `active` student with a CR/DCR role in effect for a section of the current semester can open that section's dashboard. Each endpoint checks on each request. Anyone else, including a removed CR, gets `404`.
2. CRD-DSH-02 The dashboard never shows another section's students, requests or flags. A CR of 2-II-A calling 2-II-B gets `404`.
3. CRD-DSH-03 Roster: every accepted student of the section with name, profile UV ID (or null), group, photo, `confirmed`. No phone or email keys.
4. CRD-DSH-04 Unconfirmed: last semester's matching section students (CRD-07) plus students with a pending request for this section, not accepted this semester, not "not enrolled", not `graduated` or `deactivated`. Reminder button only for state `unconfirmed`. One reminder per student per day across all the section's CR/DCRs (`429 RATE_LIMITED`).
5. CRD-DSH-05 Section routine: published routine, today first, running classes marked (`GET /api/cr/sections/:id/routine`).
6. CRD-DSH-06 Live status: section and each group, using `liveStatus` on each payload.
7. CRD-DSH-07 Free rooms: the existing free-room view. The request button is not built (R2).
8. CRD-DSH-08 Flags: status (open, fixed, rejected), category, student, description, and the admin's reply, for every flag of this section this semester.
9. CRD-DSH-09 Join requests: pending, not escalated, with accept / accept-with-group / reject. Rejected and escalated shown read-only.
10. CRD-DSH-10 Change group on the roster for any accepted student (uses `PATCH /api/enrolments/:id/group`).
11. CRD-DSH-11 Flag: category (`wrong_section`, `wrong_group`, `missing_student`, `routine_mistake`, `other`), optional roster student, description 10–1,000 characters. At most 5 per CR/DCR per day (`429 FLAG_LIMIT`). The admin sees it through the digest and spec 18.
12. CRD-DSH-12 Every dashboard action is audited with who and when: reminder (`cr.reminder`), flag (`cr.flag_raise`). Join decisions and group changes are already audited by spec 10.
13. CRD-DSH-13 Flags stay with the section, so remaining CR/DCRs still see them after a role ends.
14. Permissions table: the CR/DCR of the section and a department admin can view and act (reminders included). Only the CR/DCR can raise a flag (admin gets `404`, since the flag is the rep's action). Resolve belongs to spec 18.
15. Every route validates its params and body with Zod (shared schemas). Times are Asia/Dhaka (`toInstitutionDate`).
16. No phone or email in any response of this dashboard (privacy rule).
17. Concurrency: reminders and flags sent at the same time respect their limits exactly (test).

## Blockers / open questions

None block the spec. The PRD's open questions (email domain, launch scope, blocked periods, teachers in two departments, hosting) do not touch this dashboard. Decisions below are the spec's own.

Decisions made while planning (listed for review):
- D1 Pending applicants are in the unconfirmed list (spec decision), but only students in state `unconfirmed` get a reminder button. The server returns `409 CONFLICT` for a reminder to anyone else.
- D2 `flag` stores `department_id` (not in the spec's data list) so the digest and spec 18 can scope by department.
- D3 Flag limit is enforced with a `flag_quota` document per CR/DCR per day: a conditional `findOneAndUpdate({ user_id, date, count: { $lt: 5 } }, { $inc }, { upsert })`. A duplicate-key error means the limit is reached. This is the "first action wins" pattern, so it holds under concurrent requests.
- D4 Reminder limit uses the spec's `reminder_log` unique `{ student_id, date }`.
- D5 The overview also returns the groups list, so the group pickers need no extra endpoint. The section routine endpoint returns the section payload and one payload per group.
- D6 `FLAG_LIMIT` is a new error code (429), added to `shared/errors.js` and the server's error table.
- D7 Admin of the department may read the dashboard (permissions table). There is no admin link to it yet (that is spec 18).

## Files

Server, `server/src/modules/representatives/` (the CR/DCR concern lives here, as the module already holds CR/DCR roles):
- `cr/cr.access.js` — load the section (404 if missing or not current semester), compute `is_rep` from `crDcrOf`, call policy `cr.dashboard.view` with hide-existence.
- `cr/cr.overview.service.js` — roster, unconfirmed, join requests (pending, rejected, escalated), flags, groups, counts.
- `cr/cr.routine.service.js` — calls the routine module's `sectionRoutineFor`.
- `cr/cr.reminders.service.js` — reminder with daily limit, audit, email.
- `cr/cr.flags.service.js` — flag raise with quota, list, digest count.
- `cr/cr.controller.js`, `cr/cr.routes.js` — mounted at `/api` as `crRouter`.
- `cr/reminder.model.js` (`reminder_log`), `cr/flag.model.js` (`flag`), `cr/flag-quota.model.js` (`flag_quota`).
- `representatives.policy.js` — add `cr.dashboard.view`, `cr.dashboard.remind`, `cr.flag.raise`.
- `index.js` — register policies (already done by import), export `crRouter`, register digest provider `open_flags`.

Server, other modules (service functions, no direct collection reads from other modules):
- `routine/my-routine.service.js` — extract `buildRoutinePayload`, add and export `sectionRoutineFor({ semester, sectionId, departmentId, from?, to? })`. `routine/index.js` re-exports it.
- `enrolments/enrolment.service.js` — add `enrolmentsOfSection(sectionId, semesterId, status)`, `acceptedUserIdsOf(userIds, semesterId)`, and `hasAcceptedThisSemester(userIds, semesterId)`. Export from `enrolments/index.js`.
- `auth/students.service.js` — add `candidateStates(userIds)` (state, full name, photo, not-enrolled flag for a semester). Export from `auth/index.js`.
- `app.js` — mount `crRouter` at `/api`.

Shared:
- `shared/schemas/cr.js` — `flagBody`, `reminderBody`, `FLAG_CATEGORIES`, `FLAG_STATUSES`, `crSectionIdParam` (reuses `sectionIdParam`).
- `shared/schemas/index.js` — export it.
- `shared/errors.js` — add `FLAG_LIMIT` (429) to `ERROR_CODES` and the named constants.
- `shared/features.js` — add `cr.room_requests: 'R2'` and `cr.dashboard: 'R1'`. Overview returns `released.room_requests`, so the client hides the room-request button until R2.

Server i18n:
- `server/src/i18n/en.json` — `digest.open_flags`.

Client:
- `client/src/lib/query-keys.js` — `crOverview(sectionId)`, `crRoutine(sectionId)`.
- `client/src/features/cr/api.js` — `fetchOverview`, `fetchRoutine`, `sendReminder`, `raiseFlag`, `decideRequest` (`POST /enrolments/:id/decision`), `changeGroup` (`PATCH /enrolments/:id/group`).
- `client/src/features/cr/hooks.js` — `useCrOverview`, `useCrRoutine`, and mutations that invalidate the overview.
- `client/src/features/cr/components/`:
  - `CrHeader.jsx` — section name, semester, "you are CR/DCR", counts.
  - `JoinRequestsCard.jsx` — pending list with accept, accept with group, reject (reason); read-only rejected and escalated lists.
  - `RosterCard.jsx` — name, UV ID, photo, group select (change group).
  - `UnconfirmedCard.jsx` — name, state, reminder button (disabled with reason if not `unconfirmed`).
  - `SectionRoutineCard.jsx` — section status (`LiveStatusCard`), today's classes first, `WeekGrid` and `DayList`, then a block per group with its own `LiveStatusCard`.
  - `FreeRoomsCard.jsx` — wraps `FreeRoomsFinder`.
  - `FlagsCard.jsx` — list of flags with status and reply; "Flag a problem" button.
  - `FlagDialog.jsx` — React Hook Form + Zod: category select, optional student select (roster), description 10–1,000 characters.
- `client/src/routes/CrDashboardPage.jsx` — page for `/cr/sections/:id`; shows a "not found" message on `404`.
- `client/src/App.jsx` — add route `/cr/sections/:id` inside the app shell.
- `client/src/features/dashboard/components/SectionCard.jsx` — link to `/cr/sections/${section.id}` (was `/cr`).
- `client/src/i18n/en.json` — `cr.*` keys.

Tests:
- `server/src/modules/representatives/__tests__/cr-dashboard.api.test.js` — every acceptance test and the rules above, plus cross-section refusal, role removal, concurrency.
- `server/src/modules/representatives/__tests__/cr-flags.unit.test.js` — quota and category validation (if needed).
- `server/src/modules/routine/__tests__/section-routine.api.test.js` — `sectionRoutineFor` shape (group live status test in the CR file uses it).
- `shared/__tests__/cr-schemas.test.js` — flag body rules, reminder body.
- `client/src/routes/__tests__/cr-dashboard.test.jsx` — page renders, no phone/email, reminder button state, flag dialog validation, 404 message, group change call.
- `client/src/features/cr/__tests__/` — small unit tests for the hooks' invalidation if needed.

## Data model

- `flag` (collection `flag`): `section_id`, `semester_id`, `department_id` (D2), `raised_by`, `category` (enum), `student_id?`, `description` (10–1,000), `status` (`open` | `fixed` | `rejected`, default `open`), `reply?`, `resolved_by?`, `resolved_at?`, `created_at`. Indexes: `{ section_id: 1, created_at: -1 }`, `{ status: 1, created_at: 1 }`, `{ department_id: 1, status: 1 }`.
- `reminder_log`: `section_id`, `student_id`, `date` (YYYY-MM-DD), `sent_by`, `created_at`. Unique `{ student_id: 1, date: 1 }` (spec).
- `flag_quota`: `user_id`, `date`, `count`. Unique `{ user_id: 1, date: 1 }` (D3).

Transactions:
- Reminder: `withTransaction` inserts `reminder_log` (duplicate → `429 RATE_LIMITED`), writes the audit entry, and queues the email with `afterCommit`.
- Flag: `withTransaction` increments `flag_quota` with the conditional upsert (retry once on duplicate key, then `429 FLAG_LIMIT`), inserts `flag`, writes the audit entry.

## API

All routes need `requireAuth`. Policies run in the services. Every route validates params and body with Zod.

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/cr/sections/:id/overview` | CR/DCR of section; dept admin | none | `{ section, semester, is_rep, released, groups, roster, unconfirmed, join_requests: { pending, rejected, escalated }, flags, counts }` | `404` (`NOT_FOUND`), `STATE_NOT_ALLOWED` for non-active |
| `GET /api/cr/sections/:id/routine` | same | none | `{ server_time, today, timezone, section: payload, groups: [{ id, label, routine: payload }] }` | `404` |
| `POST /api/cr/sections/:id/reminders` | same | `{ student_id }` | `202 { data: { student_id, date } }` | `404`, `409 CONFLICT` (not `unconfirmed`), `429 RATE_LIMITED` |
| `POST /api/cr/sections/:id/flags` | CR/DCR of section | `{ category, student_id?, description }` | `201 { data: flag }` | `404`, `400 VALIDATION_ERROR`, `429 FLAG_LIMIT` |

Join endpoints from spec 10 are used unchanged by the client (`/api/sections/:id/join-requests`, `/api/enrolments/:id/decision`, `/api/enrolments/:id/group`). The overview also returns the join-request lists, so the page needs one call for its main data.

Policies (`representatives.policy.js`):
- `cr.dashboard.view`: `{ allow: active && (r.is_rep || isAdminOf(user, r.department_id)), hideExistence: true }`
- `cr.dashboard.remind`: same as view.
- `cr.flag.raise`: `{ allow: active && r.is_rep, hideExistence: true }`

`is_rep` is computed on the server from `crDcrOf(section.id)` (current semester, `ended_at: null`, this user's id). It is never taken from the request.

## Jobs and events

- Reminder: `enqueue({ template: 'semester_update_reminder', dedupe_key: 'cr_reminder:<student>:<date>' })`.
- Digest provider `open_flags`: count of `flag` with `status: 'open'` in the admin's departments (`departmentIds` null means all).
- No socket event (the dashboard is REST; the routine refresh uses the existing `routine.changed`).

## Screens

`/cr/sections/:id` (mobile first, one column):
1. Header: "CSE 2-II-A · Spring 2027 · you are CR" (or DCR), counts (join requests, roster, unconfirmed, open flags).
2. Join requests (count badge): pending with actions; rejected and escalated read-only below.
3. Roster: name, UV ID, group select, confirmed badge. No contact fields.
4. Unconfirmed: name, state, reminder button.
5. Routine and live status: section status, today first, week grid (Sun–Thu) and day list on phones, a block per group with its own live status.
6. Free rooms: `FreeRoomsFinder` (view only).
7. Flags: list with status and reply, "Flag a problem" dialog.

Translations: all text in `client/src/i18n/en.json` under `cr.*`, errors through the shared constants.

## Tests

Mapping to the spec's acceptance tests and rules (test names begin with the requirement ID):
- CRD-DSH-01 removed role → next overview `404`; non-rep active student `404`; unverified or non-active `404`/`403`.
- CRD-DSH-02 CR of 2-II-A on 2-II-B → `404`; a student of another section → `404`.
- CRD-DSH-03 roster rows have no `phone`, `email` keys (checked on the raw JSON string too).
- CRD-DSH-04 unconfirmed list includes last semester's matching section students and pending applicants; excludes accepted and not-enrolled students; CR and DCR reminding the same student on the same day → second `429`; reminding an applicant (`claim_pending`) → `409`; concurrent reminders for one student → exactly one `202`.
- CRD-DSH-05 section routine shows today's classes first (first day in payload is today) and marks running classes.
- CRD-DSH-06 in a lab period for G1 only: G1 `liveStatus` is `in_class` and G2 is `free`; section is `in_class`.
- CRD-DSH-07 free rooms view available (client test: FreeRoomsFinder renders for the CR).
- CRD-DSH-08 flags list shows status and reply, only this section and semester.
- CRD-DSH-09 join requests: pending (not escalated) for CR; rejected and escalated read-only (CR cannot decide escalated); accept with group works (via existing spec 10 tests, plus one CR-scope test here).
- CRD-DSH-10 group change by CR writes `join.group_change` audit with old and new group.
- CRD-DSH-11 6th flag in a day → `429 FLAG_LIMIT`; concurrent 7 flags → exactly 5 created; description 9 characters → `400`; description 1,001 characters → `400`; student not on roster → `400`; category not in list → `400`.
- CRD-DSH-12 reminder and flag each write an audit entry with who and when.
- CRD-DSH-13 a flag raised by a removed CR still appears in the overview for a remaining DCR.
- Cross-scope refusal for every role: student of other section, teacher, admin of other department, super admin (allowed), anonymous (`401`).
- Privacy: no phone or email in overview, routine or flags responses.
- Digest: an open flag appears in the admin's digest count (`buildDigest`).
- Client: page renders the header, roster without contact fields, unconfirmed reminder button disabled for `claim_pending`, flag dialog shows validation message for short description, `404` shows the not-found message, group change calls `PATCH /api/enrolments/:id/group`.

## Build order

1. Shared: error code `FLAG_LIMIT`, `shared/schemas/cr.js` (+ schema tests), features map entries.
2. Routine: extract `buildRoutinePayload`, add `sectionRoutineFor` (keep existing my-routine tests green; add `section-routine` tests).
3. Enrolments and auth: new read functions (`enrolmentsOfSection`, `acceptedUserIdsOf`, `candidateStates`) with unit tests.
4. Representatives CR module: models, policies, access helper, overview service, routine service (tests together with each step).
5. Reminders service and route (tests: limit, concurrency, audit, email queued, 409).
6. Flags service and route (tests: quota, concurrency, validation, roster check, privacy).
7. Digest provider `open_flags` and i18n key (test).
8. Mount router in `app.js`; run server tests.
9. Client: query keys, api, hooks, components, page, route, SectionCard link, i18n; client tests.
10. Run the `run-checks` skill; fix failures; tick the spec's tasks; set spec status to Done only if every requirement has a passing test.

## Out of scope

- Room requests and the request button (R2, spec 19).
- Resolving flags, flag list for admins, admin screens (spec 18). The admin only sees the digest count here.
- Announcements and removal requests (later release).
- Teacher views, chat, socket events for the CR dashboard.
- Any change to the join endpoints of spec 10 beyond using them.
- Commits (the user did not ask for them).

## Outcome (as built)

- Done: every task in the spec; API, policies, models, transactions and tests as planned.
- Response shapes as built:
  - `GET /api/cr/sections/:id/routine` returns `{ section, groups }`. `section` and each `groups[].routine` are routine payloads (with `server_time`, `today`, `semester`, `week`, `days`), so the client calls `liveStatus` on each.
  - The overview's join lists are `join_requests.pending` (spec 10 rows, with the CR's email exception) and `join_requests.read_only` (rejected and escalated, no email).
- Shared code added: `FLAG_LIMIT` in `shared/errors.js` and in the foundation test's code list (`server/src/__tests__/app.test.js`); `shared/schemas/cr.js`; feature entries `cr.dashboard` and `cr.room_requests`.
- Module changes outside `representatives/`: `routine` (`buildRoutinePayload` extracted from `getMyRoutine`, new `sectionRoutineFor`), `enrolments` (`enrolmentsOfSection`, `acceptedUserIdsOf`), `auth` (`studentCandidates`), `join` (`listSectionClosed`, both list functions exported). Existing behaviour is unchanged; the my-routine and dashboard suites still pass.
- Client: `/cr/sections/:id` page, `features/cr/*`, `cr.*` strings, and the student dashboard's CR link now points to the section (it was `/cr`).
- Not built (as planned): room requests (R2), flag resolution and admin screens (spec 18), announcements and removal requests (later).
