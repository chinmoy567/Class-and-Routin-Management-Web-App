# Plan: Spec 18 — Admin dashboard

Spec: `.claude/specs/18-admin-dashboard.md` (R1). PRD: Admin dashboard and controls, Core features F5/F5a, CR/DCR dashboard (Checks on CR power), Joining a section (removal from a section), Account states, Privacy, Auditability.
Final save path (after approval): `implementation-plan/18-admin-dashboard-plan.md`.

## Context / Goal

Give each admin one home page showing everything that needs attention in their scope (department admin: own department(s); super admin: everything, with a department filter), plus the management screens no other spec owns: **students** (search, deactivate/reactivate, graduate/undo, temporary-password fallback, set group, remove from a section), **flags** (resolve), **appeals and rejections**, and the **audit log viewer**. Most card data already exists in earlier specs (03-17); this spec aggregates it in one scoped call and adds the missing management actions.

Not blocked: none of the PRD's five open questions touches this spec. ADM-06 (room requests) is R2/spec 19, so that card stays hidden behind the release map. ADM-04's "removed from section groups" and ADM-20 (reported chat messages) are R3 and not built.

## What already exists and is reused

- Admin join endpoints (spec 10): `GET /api/admin/join-requests?view=escalated|rejected|appeals`, `POST /api/enrolments/:id/decision`, `PATCH /api/enrolments/:id/group` (admin override stores `group_set_by:'admin'`), `POST /api/admin/enrolments/:id/appeal-decision`, `POST /api/admin/enrolments/:id/remove` (spec 24, JR-19). ADM-16 is therefore UI plus tests, no new endpoint in this spec.
- Teacher registrations: `listRegistrations`, `POST /api/admin/teacher-registrations/:id/decision` (spec 06). Used inline.
- Flags: `Flag` model, `countOpenFlags`, digest provider `open_flags` (spec 17).
- Rollover: `readinessFor`, `listOverdueUnconfirmed` (14-day rule), `currentSemester`, `draftSemester`. Representatives: `unconfirmedOf` logic in `cr/cr.lists.js`.
- Auth: `findDepartmentsWithoutActiveAdmin`, `endAllSessions`, `contactStatus`, `studentSummaries`, `listAdmins` (super admin count logic), `hashPassword`, `changePassword`.
- Audit: `record()`, append-only model with `at`, `scope_department_id`, `target_*` indexes.
- Policy: `assertCan`/`registerPolicies` with `hideExistence`, `isAdminOf`, `hasRole`. `withTransaction`, `afterCommit`. Client `DashboardCard`/`CardMessage`, `formatDhaka`, existing admin pages and `useAdminDepartment` picker.

## Rules and acceptance checklist

Numbering follows the spec's IDs. X-items are rules from CLAUDE.md/PRD that the spec relies on.

1. **ADM-01** Teacher registrations card: pending registrations (name, department, requested short code, date; no email), inline approve and reject (reason) using the spec 06 decision endpoint.
2. **ADM-02** Join requests needing the admin (`join_requests` card): escalated join requests (JR-14), including a CR/DCR's own request (JR-18). Decide inline/linked.
3. **ADM-03** Reports from CR/DCR: open flags (name of section, category, raised by, when), newest first. Removal requests: not built (later).
4. **ADM-04** Rejected join requests and appeals: open appeals first, then recent rejections (by CR/DCR). Group removals: R3, not built.
5. **ADM-05** Routine problems: open errors and unconfirmed warnings from each in-scope department's latest import; cross-department duplicate warnings raised by another department's import (IMP-18); sections created by another department's import (IMP-27, "Section created by CSE import").
6. **ADM-06** Room requests card: hidden until R2 (`admin.room_requests: 'R2'` in `shared/features.js`); response says `released.room_requests: false`.
7. **ADM-07** Current semester card: name and status; if a draft exists, the readiness checklist (spec 14). Super admin: every department plus the "Make current" button (link to the rollover page, which already confirms); department admin sees own department only.
8. **ADM-08** Super admin only: departments without an active admin; warning when fewer than two super admins exist. Department admin never gets this card.
9. **ADM-09** Unconfirmed students per section: only students unconfirmed 14+ days after the semester became current, excluding "not enrolled" (reuses ROL-12 `listOverdueUnconfirmed`). Before day 14 the card is empty.
10. **ADM-10** Recent activity: latest 20 audit entries in scope.
11. **ADM-11** `GET /api/admin/dashboard?department_id=` returns all cards in one call, scoped by `isAdminOf`. A department admin passing another department → `403`. Super admin sees both. Non-admin → `403`.
12. **ADM-12** `GET /api/admin/students?q=&department_id=`: search by name or the profile UV ID. Row: name, photo, UV ID, section, group, state, email status `verified`/`unverified`/`bouncing`. Never the address or phone.
13. **ADM-13** Deactivate (reason required; confirmation on the client): can't sign in, all sessions end, history kept, previous state saved in `state_before_deactivation`. Reactivate restores: `active` if an accepted enrolment exists for the current semester; otherwise the previous state (`unconfirmed`, `claim_pending`, `graduated`, `email_unverified`); an `active` or `unconfirmed` account with no current enrolment → `unconfirmed`.
14. **ADM-14** Mark graduated (from `active` or `unconfirmed`), and reverse (graduated → `unconfirmed`).
15. **ADM-15** Temporary password: admin triggers it, plaintext returned once (`Cache-Control: no-store`), stored only as argon2id hash, `must_change_password = true`, all sessions end, audited (the password is never in the audit entry or logs). Next sign-in returns `next: 'change-password'`. Until changed, the server refuses everything except the change-password call, sign-out and `/auth/me`. Changing the password (or an email reset) clears the flag.
16. **ADM-16** Set a student's group by hand, remove a student from a section (reason required, confirmation), decide appeals: all through the spec 10 endpoints, with screens.
17. **ADM-17** No hard deletes. Every action here is audited with old and new values, `scope_department_id` = the student's department.
18. **ADM-18** `GET /api/admin/flags?status=` lists flags with who raised them and when. `POST /api/admin/flags/:id/resolve` `{ status: 'fixed'|'rejected', reply 1–1,000 }`; second resolve → `409 ALREADY_DECIDED`. CR/DCRs of the section see the result (spec 17 already shows status and reply).
19. **ADM-19** `GET /api/admin/audit?from=&to=&action=&actor_id=&target_id=` with paging. Department admin: only entries whose `scope_department_id` is in their departments. Super admin: all. The viewer is read-only; no update/delete endpoint exists, and no edit/delete control on screen.
20. **ADM-20** Reported chat messages audit: R3, not built.
21. **ADM-21** Destructive actions ask for confirmation on the client: deactivate and remove from section (new `ConfirmDialog`); remove role, publish routine, make current already confirm (verify, no change).
22. **ADM-22** No admin response or screen contains private messages, phone, or an email address. Only exceptions already allowed by specs 06/10 (those endpoints are unchanged; this dashboard does not show them).
23. **X1** Every protected action goes through `can()`; scope is checked on every request. A department admin on another department's student/flag by id → `404` (hide existence); explicit `department_id` of another department → `403`.
24. **X2** All times Asia/Dhaka via `lib/time.js` (date range filters of the audit viewer are institution dates converted to UTC instants).
25. **X3** First action wins: flag resolve is a conditional `findOneAndUpdate({_id, status:'open'})`; student state changes are conditional on the current state.
26. **X4** Each state change + its audit entry runs in one transaction; sessions end after commit.
27. **X5** Zod on every param/query/body, schemas shared in `shared/schemas/admin.js`. All text in `en.json`.
28. **X6** Concurrency: two simultaneous resolves → exactly one `200`; two simultaneous deactivates → one `200`, one `409 CONFLICT`.

## Decisions made while planning (for your review)

- **D1 Where it lives.** New server module `modules/admin/` (orchestrator, like `dashboard/`) for the dashboard aggregation, student management and audit viewer routes. Each card's data comes from the owning module's exported service function; no module reads another's collections. Collection-owning logic stays put: flag resolve in `representatives`, user-state primitives in `auth`, audit query in `audit`. This also avoids an `auth` → `enrolments` import cycle.
- **D2 Student's department** = `user.department_id` (set on first acceptance), or the department of a pending join request for waiting students. A student with neither is visible/actionable only to a super admin.
- **D3 Graduate** is allowed from `active`/`unconfirmed` only (`409 CONFLICT` otherwise). Deactivate is allowed from any student state except `deactivated`.
- **D4 Temporary password** is allowed for any non-deactivated student in scope (the spec's "email no longer works" is shown in the UI by the `bouncing` badge, not enforced). 12 random characters from an unambiguous set, always containing a letter and a digit. Server-side gate for `must_change_password` is a small middleware after `secondStepGate` that answers `403 STATE_NOT_ALLOWED` (no new error code).
- **D5 ADM-02** has no "UV ID conflicts" any more (removed by spec 24): the card lists escalated join requests only.
- **D6 ADM-05 "latest import"** = the most recent import per department across draft/current semesters; open = errors plus unconfirmed warnings. Cross-department duplicates are read from other departments' imports whose `CROSS_DEPARTMENT_DUPLICATE` issues name this department's code.
- **D7 ADM-09 per-section** = for each current section in scope, students of its matching last-semester section (CRD-07) who are in the overdue-unconfirmed list.
- **D8 Cards** return `{ count, items (max 10) }` and a link to the owning screen. Super admin without a filter gets all departments.
- **D9 Admin home route** `/admin` ("Admin dashboard" is the first admin nav item). A staff-only admin landing on `/` is redirected there; a teacher+admin keeps the teacher dashboard at `/` and uses the nav link.
- **D10 Audit paging** is cursor-based (`at`,`_id`), default 50, max 100. `action` filter matches exactly, or as a prefix when it ends with a dot (`join.`). Old/new values are shown with any `email`/`phone`/`password`/`token` keys stripped (defence in depth).
- **D11 Confirmation UI** for the new actions is a small accessible `ConfirmDialog` (`role="alertdialog"`), no new library.

## Files

### Shared
- `shared/schemas/admin.js` (new): `dashboardQuery`, `studentsQuery`, `studentIdParam`, `deactivateBody` (reason 5–500), `flagsQuery`, `flagIdParam`, `resolveFlagBody`, `auditQuery`; export from `shared/schemas/index.js`.
- `shared/features.js`: `admin.room_requests: 'R2'`, `admin.dashboard: 'R1'`.
- `shared/__tests__/admin-schemas.test.js` (new).

### Server — `modules/admin/` (new)
- `index.js` registers policies, exports `adminRouter`.
- `admin.policy.js`: `admin.dashboard.view` (active admin; `{department_id}` via `isAdminOf`), `admin.audit.read`, `admin.student.search`, `admin.student.manage` (`hideExistence`, `{department_id}`).
- `scope.js`: `resolveDepartments(actor, department_id)` → `null` (all) | `[ids]`; `403` for a foreign department.
- `dashboard.service.js` + `cards/*.js` (one function per card, run in `Promise.all`).
- `students.service.js`: search, deactivate, reactivate, graduate, ungraduate, temp password (transaction + audit + sessions end after commit).
- `audit.service.js`: scope resolution, name enrichment (no emails), value sanitising.
- `admin.controller.js`, `admin.routes.js` (mounted `/api/admin` behind `requireAuth`).

### Server — other modules (service functions only)
- `auth/auth.model.js`: `must_change_password` (Boolean, default false), `state_before_deactivation` (String). Index not needed.
- `auth/students.service.js`: `findStudentsForAdmin({q, departmentIds, extraUserIds, limit})`, `studentAdminRows(ids)` (name, photo, state, email_status, department_id, must_change_password), `transitionStudentState(userId, {from, to, set, unset}, session)` (conditional `findOneAndUpdate`, returns the before-document), `issueTemporaryPassword(userId, session)`, `userNames(ids)`.
- `auth/adminRoles.service.js`: `superAdminCount()`.
- `auth/auth.service.js`: `loadRequestUser` carries `must_change_password`; `changePassword` and `confirmPasswordReset` clear it.
- `auth/next.js`: `'change-password'` after the second-step cases.
- `auth/sessions.js`: `passwordChangeGate` middleware; wired in `app.js` after `secondStepGate`.
- `auth/index.js`: exports.
- `enrolments/enrolment.service.js` + `index.js`: `pendingRequesterIdsOf(departmentIds)`, `currentEnrolmentsOf(userIds, semesterId)` (section, group, enrolment id).
- `join/list.service.js`: `listForAdmin` gains optional `limit`, `newestFirst`, `semester_id` (default behaviour unchanged) so the rejected card shows the newest rejections.
- `representatives/cr/flags.admin.service.js` (new) + exports: `listFlagsForAdmin(actor,{status,department_id})`, `resolveFlag(actor,id,{status,reply})` (conditional update, audit `flag.resolve` with old/new). `representatives.policy.js`: `flag.admin`.
- `routine/problems.service.js` (new) + `index.js` export: `routineProblemsFor(departmentIds)` (D6).
- `rollover/`: `unconfirmedBySection(departmentIds)` (D7); `representatives/index.js` exports the unconfirmed-of-section helper for it.
- `audit/audit.service.js` + `index.js`: `queryEntries({departmentIds, filters, cursor, limit})`, `recentEntries(departmentIds, n)`. `audit.model.js`: add index `{actor_id: 1, at: -1}`.
- `app.js`: mount `adminRouter`, add `passwordChangeGate`.

### Client
- `features/auth/api.js`: `NEXT_PATHS['change-password']`; `routes/ForcedPasswordChangePage.jsx` (step screen, reuses `changePasswordBody` and `TextField`); `App.jsx` step route.
- `features/admin/api.js`, `hooks.js`, `lib/query-keys.js` additions.
- `features/admin/components/`: `DepartmentFilter`, `ConfirmDialog`, card components (`TeacherRegistrationsCard`, `JoinRequestsCard`, `FlagReportsCard`, `AppealsCard`, `RoutineProblemsCard`, `SemesterCard`, `MissingAdminCard`, `UnconfirmedCard`, `RecentActivityCard`), `StudentRow`, `TempPasswordDialog`, `AuditTable`.
- `routes/admin/`: `AdminDashboardPage.jsx` (`/admin`), `AdminStudentsPage.jsx` (`/admin/students`), `AdminFlagsPage.jsx` (`/admin/flags`), `AdminAppealsPage.jsx` (`/admin/appeals`), `AdminAuditPage.jsx` (`/admin/audit`).
- `components/AppShell.jsx` nav items; `routes/HomePage.jsx` redirect for staff-only admins; `i18n/en.json` (`admin.dashboard.*`, `admin.students.*`, `admin.flags.*`, `admin.appeals.*`, `admin.audit.*`, `auth.forceChange.*`, `nav.*`).

## Data model

- `user`: `must_change_password` (Boolean), `state_before_deactivation` (String). No new collection.
- `audit_log`: new index only; stays append-only (only `create`/`find` used; model guards remain).
- No new transactions beyond: each student action = one transaction (conditional state update + audit); flag resolve = conditional update + audit in one transaction.
- First-action-wins: flag resolve `findOneAndUpdate({_id, status:'open'}, …)`; no match → `ALREADY_DECIDED`. State transitions conditional on `state ∈ from`; no match → `409 CONFLICT`.

## API

All behind `requireAuth` at `/api/admin`; the policy runs in the service; Zod on params, query and body.

| Method and path | Zod | `can()` | Audit |
|---|---|---|---|
| `GET /dashboard?department_id=` | `dashboardQuery` | `admin.dashboard.view` (state active, role, department) | none |
| `GET /students?q=&department_id=` | `studentsQuery` | `admin.student.search`, department scope | none |
| `POST /students/:id/deactivate` | `studentIdParam`, `deactivateBody` | `admin.student.manage` (student's dept) | `student.deactivate` old/new state + reason |
| `POST /students/:id/reactivate` | param | same | `student.reactivate` |
| `POST /students/:id/graduate` / `ungraduate` | param | same | `student.graduate` / `student.ungraduate` |
| `POST /students/:id/temp-password` | param | same | `student.temp_password` (no secret) |
| `GET /flags?status=&department_id=` | `flagsQuery` | `flag.admin` scope | none |
| `POST /flags/:id/resolve` | `flagIdParam`, `resolveFlagBody` | `flag.admin` on the flag's department (404 otherwise) | `flag.resolve` old/new status + reply |
| `GET /audit?from=&to=&action=&actor_id=&target_id=&cursor=&limit=` | `auditQuery` | `admin.audit.read`, forced department scope | none |

Search rows include what the screens need and nothing private: `enrolment_id`, `section {id,label}`, `groups`, `uv_id` (from the profile), `email_status`.

## UI

- `/admin`: department filter (super admin), then cards in the PRD order, each with count, up to 10 items and a "view all" link. Teacher registrations approve/reject inline; join requests link to the decision; semester card shows readiness and a link to the rollover page for "Make current". Missing-admin card and the two-super-admin warning render only for a super admin.
- `/admin/students`: search box (name or UV ID), result rows with state/email-status badges and actions: Deactivate (reason + confirm), Reactivate, Graduate/Undo, Temporary password (confirm, then shown once with a copy button and a warning), Set group (select), Remove from section (reason + confirm).
- `/admin/flags`: tabs open/fixed/rejected; resolve form with status and reply (1–1,000 characters).
- `/admin/appeals`: open appeals first, rejections; accept/uphold actions via the spec 10 endpoints.
- `/admin/audit`: filters (date range, action, actor, target), paged table, no edit/delete controls.
- `/change-password` step screen for accounts with a temporary password.
- Mobile first (360 px), labelled controls, `role="status"` for results, focus kept in dialogs.

## Tests

Each test name starts with its requirement ID.

Server (`modules/admin/__tests__/`, plus small unit tests):
- ADM-11 dashboard scoping: CSE admin with `?department_id=EEE` → `403`; super admin sees both; no param for a CSE admin → only CSE; student/teacher/anonymous → `403`/`401`.
- ADM-01..10 each card returns the right items in scope and none from another department (one test per card, two departments in the world). ADM-06 absent. ADM-08 absent for a department admin; present for super admin; fewer-than-two warning. ADM-09 empty before day 14, filled after, "not enrolled" excluded (fixed clock). ADM-05 cross-department duplicate and created-section notices.
- ADM-12 search by name and by UV ID, email status values, response string has no `@`/phone; another department's students never returned.
- ADM-13 deactivate: login refused, open session removed from `sessions`, reason required, reactivate → `active` with enrolment, → `unconfirmed`/`claim_pending` otherwise; cross-department → `404`; concurrent double deactivate.
- ADM-14 graduate/ungraduate state checks and audit.
- ADM-15 temp password returned once and works for login; next sign-in returns `next: 'change-password'`; other endpoints refused until `POST /api/me/password`; flag cleared; sessions ended; audit has no secret; `Cache-Control: no-store`.
- ADM-16 admin sets group (`group_set_by:'admin'`), remove from section, appeal decision through the spec 10 endpoints with cross-department refusals.
- ADM-17 audit entries have old and new values and the right `scope_department_id` for every action; no student row is removed.
- ADM-18 resolve flag, second resolve → `ALREADY_DECIDED`, concurrent resolves → one `200`, reply 0/1,001 chars → `400`, CR sees the result in the CR overview, other department's flag → `404`.
- ADM-19 CSE admin audit query never returns an EEE entry (also with `target_id`/`actor_id` of EEE data); super admin sees all; filters and paging; date range respects `Asia/Dhaka` day edges; assertion that the audit router exposes only `GET` and that `AuditLog` update/delete throws.
- ADM-22 privacy sweep over every new response for email, phone, hash keys.
- X1 refusal matrix for every endpoint: student, teacher, CR, admin of another department (refused), super admin (allowed), anonymous.
- Policy/unit tests for `resolveDepartments`, audit sanitising, temp-password generator rules, reactivate-state decision.

Shared: `admin-schemas.test.js`.

Client (`routes/__tests__/`): ADM-01 inline approve/reject; ADM-03/04 cards render; ADM-08 hidden for department admin; ADM-12 results without contact fields; ADM-13/ADM-21 deactivate requires reason and confirmation, remove from section requires reason and confirmation; ADM-15 temp password shown once then cleared, forced change screen at `next: 'change-password'`; ADM-18 reply validation message; ADM-19 audit page has no edit/delete controls; staff-only admin redirected from `/` to `/admin`.

## Build order

1. Shared schemas, feature entries (+ tests).
2. Auth primitives: model fields, `students.service.js` additions, `must_change_password` flow (`next`, gate, clearing) (+ ADM-15 tests).
3. Audit: `queryEntries`/`recentEntries`, index (+ unit tests).
4. Enrolments, join, representatives, routine, rollover service additions (+ unit tests).
5. `admin` module: policies, scope, students service and routes (+ ADM-12..17, scope tests).
6. Flags admin service and routes (+ ADM-18 tests incl. concurrency).
7. Audit routes (+ ADM-19 tests).
8. Dashboard cards and `GET /dashboard` (+ ADM-01..11 tests).
9. Mount in `app.js`; run the whole server suite.
10. Client: api, hooks, query keys, ConfirmDialog, forced-change page, cards, dashboard page, students, flags, appeals, audit pages, nav, i18n (+ client tests).
11. `run-checks` (lint, tests, build); `format:check`; tick the spec's tasks; set spec status to Done only if every requirement has a passing test.

## Out of scope

Room requests card (R2, spec 19). Removal requests (later). Group-removal list and reported-message viewing (R3, specs 20-22). Teacher, semester, rollover, import/edit, CR/DCR, rooms, calendar, department and admin screens (their own specs; only linked). Emailing the student about a deactivation (spec has none). Hard deletes. New libraries. Commits.

## Verification

`npm test -w @crm/shared`, `npm test -w @crm/server`, `npm test -w @crm/client`, then `npm run lint`, `npm run format:check`, `npm run build` (via the `run-checks` skill). Optionally run the app (`npm run dev:server`/`dev:client` with a seeded super admin) and click through `/admin`, students, flags, audit and the forced password change.

## Deviations made during the build (as built)

- **Student's department (D2, changed):** the department of a student comes from `user.department_id`, or from the department on their enrolments (any status). `enrolledUserIdsOfDepartments` replaces the planned `pendingRequesterIdsOf`. `departmentOfStudent` gives the fallback for the admin check.
- **Temporary password (D4, narrowed):** only for `claim_pending`, `unconfirmed`, `active` and `graduated`. An `email_unverified` account cannot change its password (`account.change_password`), so a temporary password there would trap the student on the change screen. `deactivated` is refused.
- **Forced change gate:** `passwordChangeGate` runs after `secondStepGate` and answers `403 STATE_NOT_ALLOWED` for every path except health, CSRF, logout, `/api/auth/me` and `/api/me/password`. `next` returns `change-password` before the state switch, so it applies to every state.
- **Flags:** an explicit foreign `department_id` on the flag list is `403 FORBIDDEN` (as the plan's X1 says). A single flag of another department is `404` on resolve (hide existence).
- **ADM-05 (D6):** the latest import of each department in draft or current semesters. All unconfirmed issues count, errors and warnings alike. Found and fixed during the build: `aggregate()` does not cast ids, so the semester ids are converted to ObjectIds in the match.
- **ADM-04:** an appealed rejection is shown once, as the appeal (the rejected list drops it).
- **ADM-09:** uses the representatives' `unconfirmedOfSection` for each in-scope section, intersected with rollover's `listOverdueUnconfirmed`. No new rollover function was added.
- **Card data shape:** each card is `{ count, items }` (at most 10 items). `missing_admin` is present only for a super admin. `room_requests` is absent (ADM-06), with `released.room_requests: false`.
- **File layout:** all dashboard cards are in one server file (`dashboard.service.js`) and one client file (`DashboardCards.jsx`), not one file per card.
- **Tests:** the plan's separate unit tests for the enrolment, rollover and problems functions were not written. Those functions are covered through the admin API tests (`students`, `flags`, `audit`, `dashboard`) and the audit unit file.
- **Escalated requests** (including a CR/DCR's own) are decided inline on the dashboard, through the spec 10 endpoint `/enrolments/:id/decision`.
- **Not built (later releases):** ADM-06 room requests card (R2), ADM-04 group-removal list and ADM-20 reported-message audit (R3).
