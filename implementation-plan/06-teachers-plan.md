# Plan: Spec 06 – Teachers

(Spec: `.claude/specs/06-teachers.md`. The `specs/` path in the command does not exist; specs live in `.claude/specs/`. Saved and treated as approved because the run is unattended.)

## Goal
A teacher who verifies their email gets a `pending` registration. The department admin approves (account `pending` → `active`, `teacher` role for that department, optional short-code link in the same step) or rejects with a reason (account stays `pending`; the teacher may apply again). Admins keep teacher records (department + short code + full name), link and unlink them to accounts, and suspend, remove or reactivate teacher accounts. The module exports the directory functions for the routine specs.

## Rules and acceptance criteria
1. TCH-01 Verifying a teacher's email creates a `pending` `teacher_registration` (department + requested short code from sign-up), in the verification transaction.
2. TCH-02 Admin of the department lists registrations with full name, email (privacy exception), department, requested code, date and earlier rejections with reasons.
3. TCH-03 Approve: registration → `approved`, account `pending` → `active`, `teacher` role granted for the department, teacher emailed; first action wins (`findOneAndUpdate` on `status: 'pending'`) → `ALREADY_DECIDED` (409).
4. TCH-04 Reject needs reason 5–500 chars; registration → `rejected`; account stays `pending`; teacher emailed with the reason; sign-in shows rejection screen with "apply again".
5. TCH-05 Apply again with corrected department/code creates a new `pending` registration; one pending per account (partial unique index) → `CONFLICT`.
6. TCH-06 Approval and rejection audited.
7. TCH-07 `teacher` record: department + short code (upper-case) + full name; `(department_id, short_code)` unique; added by hand (import comes in spec 07). `TBA` is reserved, never a record.
8. TCH-08 Admin of D links an `active` teacher account to an unlinked record of D; already linked → `CONFLICT`; not eligible → `USER_NOT_ELIGIBLE`. Approval links in the same step when a matching unlinked record exists (or `teacher_id` is given). Same code in two departments can go to different accounts.
9. TCH-09 `SHORT_CODE_AMBIGUOUS` only arises in a staged import (spec 07); the unique index prevents it in saved records. Nothing to build here.
10. TCH-10 Link/unlink audited; a listener registry (`registerLinkChangeListener`) lets spec 12 invalidate the routine cache.
11. TCH-11 Unlinked teacher: profile teacher block says `linked: false` (dashboard message is spec 16).
12. TCH-12 Suspend / remove need a reason, are audited, end all the teacher's sessions; a suspended teacher signing in → `ACCOUNT_DISABLED` (existing).
13. TCH-13 Reactivate a suspended or deactivated teacher → `active`.
14. TCH-14 Removing does not touch records/links (routine unchanged).
15. TCH-15 Exports `findByCode(departmentId, shortCode)`, `fullNames(ids)`; `TBA` → `null`.
16. TCH-16 `sectionsTaughtBy(userId)` computed server-side from linked records through a provider registry (spec 07 registers the real provider; none → `[]`).
17. Permissions: all admin actions = admin of the department or super admin, account `active`; a CSE admin deciding an EEE registration → 403; list scoped to own departments.

## Blockers / open questions
- PRD Open question 4 (one account in two departments) does not block: the spec's `(user_id, department_id)` index works either way.
- Decisions: (a) linking needs the account to hold the `teacher` role in that record's department (stricter than the spec, avoids a CSE admin touching an EEE-only teacher); (b) suspend/remove/reactivate scope = departments where the account holds a `teacher` role; (c) remove/suspend apply to `active` (remove also to `suspended`); (d) a new `teacher-rejected` value for `next` so the client can show the rejection screen; (e) auth gets two small hook registries (`registerTeacherVerifiedHook`, `registerPendingScreen`) so it never imports the teachers module.

## Files
Server `server/src/modules/teachers/`: `teachers.model.js`, `teachers.policy.js`, `registration.service.js`, `directory.service.js`, `account.service.js`, `teachers.controller.js`, `teachers.routes.js`, `index.js`, `__tests__/teachers.api.test.js`.
Changed: `auth/auth.service.js` (verify hook), `auth/next.js` (pending screen), `auth/index.js` (exports), `app.js` (mount), `notifications/templates/index.js` + `server/src/i18n/en.json` (2 emails), `test/harness.js` (model import), `shared/schemas/teachers.js`, `shared/schemas/index.js`, `shared/enums.js` (`teacher-rejected`).
Client: `features/teachers/{api,hooks}.js`, `routes/admin/TeacherRegistrationsPage.jsx`, `routes/admin/TeachersPage.jsx`, `routes/TeacherRejectedPage.jsx`, `App.jsx`, `AppShell.jsx`, `features/auth/api.js`, `lib/query-keys.js`, `i18n/en.json`, `routes/__tests__/teachers.test.jsx`.

## Data model
- `teacher_registration`: user_id, department_id, requested_short_code, status, reason?, decided_by?, decided_at?, created_at. Partial unique `{user_id}` where `status:'pending'`.
- `teacher`: department_id, short_code, full_name, user_id?, created_from. Unique `{department_id, short_code}`; partial unique `{user_id, department_id}` where `user_id` is an ObjectId.
- Approve = one transaction: conditional registration update, conditional user update (`state:'pending'`), role insert, optional link. Link = conditional `findOneAndUpdate` on records with no `user_id`.

## API
As in the spec table (`/api/admin/teacher-registrations`, `/decision`, `/api/me/teacher-registration`, `/api/admin/teachers`, `/:id`, `/link`, `/unlink`, `/api/admin/teacher-accounts/:userId/{suspend,remove,reactivate}`). Zod in `shared/schemas/teachers.js`. Policies: `teacher.admin` (active admin of department), `teacher.apply` (pending teacher).

## UI
Admin pages "Teacher registrations" (approve with optional record, reject with reason) and "Teachers" (records, add, link, unlink, suspend/remove/reactivate). Pending teacher: waiting screen (existing) or rejected screen with reason and apply-again form. All text in `en.json`.

## Tests
Server API tests named by requirement id (TCH-01…TCH-16, concurrency approve, cross-department 403/404 refusals, session end, audit). Client test for registrations page and rejected screen.

## Build order
1. shared schemas/enums → 2. models + policy → 3. registration service + verify hook → 4. directory + link → 5. account actions → 6. routes, mount, emails → 7. server tests → 8. client → 9. client tests → 10. run-checks.

## Out of scope
Import of teacher records (07), dashboard (16), email catalogue/digests (15), routine cache itself (12), `SHORT_CODE_AMBIGUOUS` (07).

## Departures from the plan
- Added `GET /api/admin/teacher-accounts?department_id=` (name, state, link flag; no email) so the Teachers page can offer accounts to link, suspend, remove and reactivate. Policy: `teacher.manage` on the department.
