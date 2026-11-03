# Plan: Spec 14 — Semester rollover

Spec file: `.claude/specs/14-semester-rollover.md` (the specs live in `.claude/specs/`, not `specs/`). After approval this plan is saved to `implementation-plan/14-semester-rollover-plan.md` (repo root; the only plan folder).

## Goal
The super admin makes the draft semester current in one safe transaction. Before that, each department's readiness is shown as a four-item checklist. The rollover archives the old semester, ends its CR/DCR roles, switches the draft's roles on (with accepted enrolments), turns every `active` student into `unconfirmed` with one `updateMany`, and then (after commit) runs hooks, clears caches, broadcasts events, audits with counts and sends the day-0 reminder. `unconfirmed` students get a semester update screen (pre-filled join form, "I have completed my degree", "Not enrolled this semester"). A daily job sends the day-7 and day-14 reminders, and a service lists students still unconfirmed after 14 days for spec 18.

## Rules and acceptance criteria (checklist)
1. ROL-01 Readiness per department for the draft: (a) ≥1 section, (b) a published import with zero errors, (c) every section has a CR, (d) ≥1 active room. Each item ✔/✘ with a count ("3 of 8 sections have no CR").
2. ROL-02 Dept admin sees only their own department's checklist; super admin sees all.
3. ROL-03 Make current needs confirmation. If a department is not ready the server answers `NOT_READY_UNCONFIRMED` naming each department and its reasons; the super admin must send `confirm_not_ready` with those codes.
4. ROL-04 One transaction: (1) old current → `archived`, (2) its CR/DCR roles end (`ended_at`, `semester_ended`), (3) draft → `current`, (4) every `active` student → `unconfirmed`, `confirmed_semester_id` untouched, (5) draft CR/DCR each get an accepted enrolment and become `active`, (6) sections with a CR are open (derived, nothing to write). After commit: group hooks (spec 20), routine caches cleared, `routine.changed` + `calendar.changed` broadcast, audit with counts.
5. ROL-04 atomic: a failure at any step leaves the old semester current and students `active`.
6. ROL-05 Idempotent and guarded: runs only if the semester is still `draft`; a second or concurrent press gets `ALREADY_DECIDED`.
7. ROL-06 A not-ready department finishes after the rollover; its sections open when each gets a CR; its students see "Your department is still setting up this semester" (already built in spec 10 JR-03; test only).
8. ROL-07 Student state change is a single `updateMany`.
9. ROL-08 `GET /api/me/semester-update` for an `unconfirmed` student: pre-filled department and section letter, suggested next level/term (2-I→2-II, 2-II→3-I). Everything can be changed except the approved UV ID.
10. ROL-09 `can_graduate` only if the last confirmed term was 4-II; `POST /api/me/graduate` → `graduated`, no join request; otherwise `NOT_FINAL_TERM`.
11. ROL-10 `POST /api/me/not-enrolled`: stays `unconfirmed`, sets `not_enrolled_semester_id` = current, no reminders, off the overdue list until they send a join request.
12. ROL-11 `unconfirmed`: profile and one-to-one chat allowed; My routine, live status, free rooms, section group refused (`STATE_NOT_ALLOWED`); the old group stays read-only.
13. ROL-12 Service lists students unconfirmed 14 days after `made_current_at`, excluding "not enrolled" (consumed by spec 18).
14. ROL-13 Reminder email to every `unconfirmed` student (not "not enrolled") at day 0, 7, 14; once per student per milestone.
15. [PRD] CSE ready + EEE not ready: warning names EEE; after confirming all `active` students become `unconfirmed`, Fall 2026 CR roles end, CSE sections open, EEE sections stay closed.
16. Acceptance: draft CR is `active` with an accepted enrolment right after rollover (ROL-04(5)).
17. Acceptance: a 3-I student calling graduate → `NOT_FINAL_TERM`; a 2-II student gets 3-I suggested.
18. Acceptance: not-enrolled student gets no day-7 reminder and is not on the 14-day list.
19. Cross-scope/permission: dept admin, CR/DCR, teacher, `active` student and other states cannot make current; dept admin cannot read another department's checklist; only `unconfirmed` students reach the update endpoints.
20. Concurrency: two simultaneous "make current" → one 200, one `ALREADY_DECIDED`.

## Blockers / open questions
None of the PRD's open questions blocks spec 14. Decisions I will take (tell me if you disagree):
- **D1 New module `server/src/modules/rollover/`.** It orchestrates organisation, auth, representatives, enrolments, routine, rooms. Putting it in `organisation` would create import cycles (those modules already import organisation). Precedent: `join`, `representatives`, `enrolments` are modules beyond the CLAUDE.md list. Each other module gets one new exported service function; nothing reads another module's collection.
- **D2 Withdraw old pending join requests at rollover.** A request still `pending` against the archived semester would block the student's new request (`REQUEST_ALREADY_OPEN`, unique pending index). The transaction sets them `withdrawn` and deletes their undecided UV claims (same as `withdrawRequest`). Counted in the summary as `requests_withdrawn` (one extra field beyond the spec's five).
- **D3 Draft CR/DCR whose account is no longer eligible** (deactivated/graduated since being named): role row stays, no enrolment, not activated, not counted.
- **D4 No current semester** (all archived or first ever): make-current still works (nothing to archive); the first-ever bootstrap (spec 04) stays as it is.
- **D5 14-day list = exported service only** (`listOverdueUnconfirmed`), no HTTP route; spec 18 adds the endpoint and screen. The readiness panel on the admin dashboard card is spec 18; here it is a standalone page `/admin/rollover`.
- **D6 `nextScreen` change:** an `unconfirmed` student with a pending request goes to `waiting-approval` (today it is always `semester-update`, which would hide the pending request). Needed for ROL-08 to work end to end.
- **D7 Known gap, out of scope:** the client route guard holds `unconfirmed` (and `claim_pending`) students on one screen, so they cannot navigate to profile/chat in the UI yet. Same limit exists from spec 10. The server permissions (ROL-11) are implemented and tested.

## Files
Server (`server/src/modules/…`)
- `rollover/` (new): `index.js` (register policies, export router, jobs, `registerRolloverHook`, `listOverdueUnconfirmed`), `rollover.policy.js`, `rollover.routes.js`, `rollover.controller.js`, `readiness.service.js`, `makeCurrent.service.js`, `semesterUpdate.service.js`, `reminders.service.js`, `reminders.jobs.js`, `hooks.js`, `overdue.service.js`, `__tests__/` (`readiness.api.test.js`, `makeCurrent.api.test.js`, `semesterUpdate.api.test.js`, `reminders.test.js`, `units.test.js`).
- `organisation/semester.service.js` + `organisation.model.js` + `index.js`: add `rollover_summary`, `reminders_sent: [Number]` to the semester schema; export `archiveCurrentSemester(session)`, `promoteDraft(id, {by, summaryPatch}, session)` (conditional `findOneAndUpdate({_id, status:'draft'})`, `null` → caller throws `ALREADY_DECIDED`), `setRolloverSummary`, `markReminderSent(semesterId, milestone)` (conditional `$addToSet`).
- `auth/auth.model.js`: add `not_enrolled_semester_id`, `graduated_at` to `user`. `auth/students.service.js` + `index.js`: `unconfirmActiveStudents(session)` (one `updateMany`), `activateRepresentatives(userIds, semesterId, session)` (only `claim_pending`/`unconfirmed`, sets `confirmed_semester_id`, returns the ids changed), `studentForUpdate(userId)`, `graduateStudent`, `markNotEnrolled`, `listUnconfirmedStudents(excludeNotEnrolledFor)`; clear `not_enrolled_semester_id` handled where a join request is created (see join).
- `auth/next.js`: D6.
- `representatives/remove.service.js` already exports `endRolesOfSemester` (reuse). Add to `query.service.js`/`index.js`: `draftRoleHolders(semesterId, session)` (CR/DCR rows with user and section), `sectionsWithoutCr(semesterId, departmentId)` → `{ total, without_cr }`.
- `enrolments/enrolment.service.js` + `index.js`: `withdrawPendingOfSemester(semesterId, session)` (D2), `lastAcceptedEnrolment(userId, semesterId)`, `createAcceptedForRepresentative` reused (add `department_id`).
- `routine/index.js` + a small `routine/readiness.provider.js`: `sectionCountOf(semesterId, departmentId)` (use `listSectionsBrief`), `hasPublishedZeroErrorImport(semesterId, departmentId)`, `clearRoutineCaches()` (wrap `clearAll`).
- `rooms/index.js` + `rooms.service.js`: `countActiveRoomsOf(departmentId)` (owner department, `retired:false`).
- `join/request.service.js`: when an `unconfirmed` student creates a request, clear `not_enrolled_semester_id` (ROL-10 "until they send a join request").
- `notifications/templates/index.js` + `server/src/i18n/en.json`: template `semester_update_reminder` (spec 15 lists it; only this one is added now).
- `app.js`: mount `rolloverAdminRouter` (admin) and `rolloverMeRouter` (`/api/me`). `server.js`: register `defineRolloverJobs`, schedule `semester.reminders` daily at 09:00 `Asia/Dhaka`.
Shared (`shared/`)
- `errors.js`: add `NOT_READY_UNCONFIRMED` (409), `NOT_FINAL_TERM` (409); also the FND-11 code list in `server/src/__tests__/app.test.js` and `client/src/i18n/en.json`.
- `schemas/rollover.js` (export from `schemas/index.js`): `makeCurrentBody` `{ confirm_not_ready?: string[] }`, `nextTerm(level, term)` pure helper, with a unit test in `shared/__tests__`.
Client (`client/src/`)
- `features/rollover/api.js`, `hooks.js`, query keys in `lib/query-keys.js`.
- `routes/admin/RolloverPage.jsx` (readiness cards + Make current + not-ready confirmation); route `/admin/rollover` (admin; the button only for super admin); nav entry and `SemestersPage` link.
- `routes/SemesterUpdatePage.jsx` replaces the `HoldingPage screen="update"` route; extract the join form from `JoinPage.jsx` into `features/join/components/JoinForm.jsx` taking `prefill` and `children` (JoinPage keeps its behaviour); graduate and not-enrolled sections with confirmation dialogs.
- `i18n/en.json`: all new strings (including error code messages and "Your department is still setting up this semester" already present).

## Data model
- `semester`: `rollover_summary { archived_semester_id, students_unconfirmed, roles_ended, roles_started, requests_withdrawn, at, by }`, `reminders_sent: [Number]`. Existing partial unique indexes (`one_current`, `one_draft`) stay; the old semester is archived first inside the transaction so `one_current` is never violated.
- `user`: `not_enrolled_semester_id?`, `graduated_at?`. No new indexes needed (the unconfirmed query uses `{kind, state}`; add `{ state: 1, kind: 1 }` index in the schema for the 6,000-row `updateMany`).
- Transaction (`withTransaction`, in `makeCurrent.service.js`), in this order: archive old current (conditional on `status:'current'`) → `promoteDraft` (conditional on `status:'draft'`; `null` → `ALREADY_DECIDED`, which aborts the transaction and restores the old semester) → `endRolesOfSemester(old)` → `withdrawPendingOfSemester(old)` → `unconfirmActiveStudents` → for each draft CR/DCR holder: eligible check, `createAcceptedForRepresentative`, collect ids → `activateRepresentatives` → summary + `audit.record` (`semester.make_current`, counts, same session). Concurrent presses write the same documents, so one gets a write conflict, retries and then sees `status !== 'draft'` → `ALREADY_DECIDED`.
- After commit (`afterCommit`/`emitAfterCommit`): `runRolloverHooks({ archived, current, sectionsWithCr })`, `clearRoutineCaches()`, `routine.changed` and `calendar.changed` to `everyone`, enqueue the day-0 reminder job.
- Reminder idempotency: per-student `dedupe_key = semester_update:<semesterId>:<userId>:<day>` on `enqueue`, plus `semester.reminders_sent` to skip rescans (marked after sending; a retried job re-sends nothing thanks to the dedupe keys).

## API
All bodies/params/queries validated with Zod via `validate()`.
| Method + path | `can()` check | Notes / errors | Audit |
|---|---|---|---|
| `GET /api/admin/semesters/:id/readiness` | `rollover.readiness` per department: state `active`, super admin all, `dept_admin` via `isAdminOf(dept)` | returns only departments the actor may see; non-draft id → 404 | none |
| `POST /api/admin/semesters/:id/make-current` body `{ confirm_not_ready?: string[] }` | `rollover.make_current`: `active` super admin only | `NOT_READY_UNCONFIRMED` (409, `departments:[{code, reasons}]`), `ALREADY_DECIDED` (409), 404 for unknown id | `semester.make_current` with counts |
| `GET /api/me/semester-update` | `semester_update.use`: student, state `unconfirmed` | `STATE_NOT_ALLOWED` otherwise; returns `{ semester, prefill:{department_id, level, term, letter}, last_semester, suggested, can_graduate, not_enrolled }` | none |
| `POST /api/me/graduate` | same policy | `NOT_FINAL_TERM`; conditional `findOneAndUpdate({_id, state:'unconfirmed'})` → `graduated`, `graduated_at` | `student.graduate` |
| `POST /api/me/not-enrolled` | same policy | sets `not_enrolled_semester_id` | `student.not_enrolled` |
Jobs: `semester.reminders` daily 09:00 (`Asia/Dhaka`) sends day 7 and day 14 reminders; also run once with `{milestone: 0}` after the rollover commit.

## UI
- Rollover page: one card per department (code, four items with ✔/✘ text + counts, ready badge), "Make current" (super admin only). Pressing it opens a confirmation; a not-ready answer from the server shows the department names and reasons and asks for a second confirmation, then resubmits with `confirm_not_ready`. Success shows the summary counts. Dept admin sees their own card only, no button.
- Semester update page: intro with the new semester name, the pre-filled join form (department, section, group; UV ID hidden once approved), rejection notice reused, "I have completed my degree" (only when `can_graduate`, with confirm), "Not enrolled this semester" (with confirm), sign out. Account-state screens: the old holding page route is replaced; pending request → waiting page (D6).
- Strings only through `t()`; labels on every icon-only status; 360 px, ✔/✘ also carry text.

## Tests (map to checklist numbers)
Server (Vitest + Supertest + mongodb-memory-server replica set; clock fixed with `fixClock`):
- `readiness.api.test.js`: 1 (each of a–d ✔/✘ with counts), 2 + 19 (dept admin sees own department only, other department absent; CR, teacher, student refused).
- `makeCurrent.api.test.js`: 3 (warning names EEE, confirm passes), 4 (archived, roles ended, draft current, states, enrolments, summary), 5 (force a failing step via a throwing hook-free fault such as a stubbed `activateRepresentatives` and assert nothing changed), 6 + 20 (two simultaneous calls via `Promise.all`), 7 (EEE sections closed, student sees `setting_up`; opens when a CR is added), 8 (assert one `updateMany` with many students), 15 ([PRD] scenario end to end), 16, D2 (old pending request withdrawn, new request allowed), D3, D4, audit entry and counts, events/hooks/cache cleared after commit and not on failure, 19 (every role/state refused).
- `semesterUpdate.api.test.js`: 9, 10, 11, 12 (My routine, free rooms refused for `unconfirmed`; profile and public profile allowed), 17 (3-I graduate → `NOT_FINAL_TERM`; 2-II → 3-I; 4-II can graduate), D6 (`/api/auth/me` next screen), cross-state refusal (`active`, `claim_pending`, teacher, admin).
- `reminders.test.js`: 14, 18 (day 0/7/14, once per student, not-enrolled excluded, confirmed students excluded, job re-run sends nothing new), `listOverdueUnconfirmed` (13).
- `shared` unit: `nextTerm`. Client (Vitest + Testing Library): Rollover page (not-ready confirmation flow, dept admin without button) and Semester update page (pre-fill, graduate option only after 4-II, not-enrolled call, rejection notice); existing join tests must still pass after the form extraction.
Concurrency tests use `Promise.all` against the real routes.

## Build order (tests written with each step)
1. Shared: error codes, `nextTerm`, `makeCurrentBody`, unit test.
2. Model fields + exported helpers in organisation, auth, enrolments, representatives, routine, rooms (+ small tests).
3. Readiness service + route + policy + tests.
4. Make-current transaction + post-commit hooks + route + tests (incl. concurrency and atomicity).
5. Semester update endpoints, `nextScreen` change, join clearing `not_enrolled` + tests.
6. Reminder template, service, job registration and tests; overdue service.
7. Client: query keys, api/hooks, Rollover page, JoinForm extraction, Semester update page, i18n, tests.
8. `run-checks` (lint, tests, build), then `/verify-spec 14` report under `test-results/`; tick the spec tasks and set its status.

## Out of scope
Creating the draft (spec 04), join request mechanics (spec 10), creating/closing section groups (spec 20 hook only registered), the CR/DCR one-reminder-per-day button (spec 17), the admin dashboard card and the Unconfirmed-students screen (spec 18), email batching/digests/bounces (spec 15), UI navigation from the step screens to profile/chat (D7), reversing graduation (spec 18).

## Verification
`npm test -w @crm/server`, `npm test -w @crm/client`, `npm test -w @crm/shared`, `npm run lint`, `npm run build`, `npm run format:check`; then `/verify-spec 14`. Node 24.22.2 (24.15.0 kills vitest workers). Manual: run both dev servers, create a draft with CSE ready and EEE not, open `/admin/rollover`, make it current, sign in as a former `active` student and see the update screen.

## Departures from this plan (made while building)
- **Reminders are idempotent through the agenda dedupe key** (`semester_update:<semester>:<user>:<milestone>`). The `semester.reminders_sent` field was not added.
- **No `activateRepresentatives` helper.** The rollover calls the existing `activateStudentForSemester` for each draft CR/DCR.
- **`roles_skipped` added** to the summary, for D3 (ineligible draft role holders).
- **Post-commit steps log their own failures** (`rollover post-commit step failed`). The rollover is already saved, so a reminder or hook error must not return 500.
- **Readiness is computed just before the transaction**, not inside it. A change in the few milliseconds between the two is not re-checked.
- **Self-service routes** mount at `/api/me` with `requireAuth` on each route. A mount at `/api` with `requireAuth` caught every unknown `/api` path and broke the 404 tests.
- **Join form reused, not extracted.** `JoinPage` takes optional `prefill`, `title`, `intro` and `footer` props. `features/join/components/JoinForm.jsx` was not created.
- **`HoldingPage` removed**, with its `auth.holding` strings. Its only use was the update screen.
- **Admin navigation:** a "Rollover" entry in the admin nav. No link from the Semesters page.
- **`ApiError.details`** now carries the full error body, so the not-ready list reaches the screen.
- **Not built:** spec 20 group hooks (the hook point is registered), the read-only old section group (ROL-11), the overdue list screen (spec 18), and the step-screen navigation gap (D7).
- **ROL-07** (one `updateMany`) is covered by the outcome test, not by a test that counts the write itself.

