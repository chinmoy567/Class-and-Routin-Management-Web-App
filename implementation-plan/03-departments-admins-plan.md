# Plan: spec 03 — Departments and admins

Spec: `.claude/specs/03-departments-admins.md` (the only match for `3`; specs live in `.claude/specs/`, not `specs/`).
Save target after approval: `implementation-plan/03-departments-admins-plan.md` (does not exist yet).

## Goal

Super admins keep the department list (create, rename, retire) and decide who is an admin (grant/remove `dept_admin` and `super_admin`). The last super admin can't be removed, nobody edits their own roles, role changes end the target's sessions, super admins can reset another admin's password or second step, and a department left without an active admin triggers an email to every super admin plus a "no active admin" listing. Builds on spec 01 (`User`, `UserRole`, `isAdminOf`, sessions, tokens, mail, audit) and replaces the `setDepartmentLookup` stub spec 01 left in `organisation`.

## Rules and acceptance criteria checklist

1. **DEP-01** Create dept: code 2–10 upper-case letters, unique, plus name. [A] duplicate code → `CONFLICT`.
2. **DEP-02** Rename; code can't change once a section/room/teacher/routine refers to it (`CODE_LOCKED`).
3. **DEP-03** Retire: hidden from the join form/teacher sign-up list, history kept; refused while a section of the current or draft semester uses it (`DEPARTMENT_IN_USE`). [A] retire with a draft-semester section → `DEPARTMENT_IN_USE`.
4. **DEP-04** `GET /api/departments` public, active only, code + name.
5. **DEP-05** Grant `dept_admin` (one department) to an `active`, email-verified account; teachers keep teacher role. [A] `email_unverified` target → `USER_NOT_ELIGIBLE`.
6. **DEP-06** Grant `super_admin` to an `active`, verified account.
7. **DEP-07** Remove either role; removing the last active super admin → `409 LAST_SUPER_ADMIN`; dashboard data says when fewer than two exist. [A] one left → `409 LAST_SUPER_ADMIN`.
8. **DEP-08** No grant/removal on own account (`FORBIDDEN`); admin roles never come from sign-up. [A] self-removal → `FORBIDDEN`.
9. **DEP-09** Grant/removal ends the target's sessions. [A] old session → `UNAUTHENTICATED`; next sign-in asks for the second step.
10. **DEP-10** Audit every grant/removal: who, when, role, department.
11. **DEP-11** Reset a dept admin's or another super admin's password (link to the admin's own email) or second step (clear TOTP); never on self; each audited.
12. **DEP-12** A department with no active `dept_admin` (role removed, account deactivated/suspended) emails every super admin once and shows in the "without an active admin" list. [A] removing a department's only admin emails every super admin once.
13. **DEP-13** `isAdminOf` true for super admins and a dept admin of their own department only (already in `policy/helpers.js`; add tests, ignore ended roles).
14. **DEP-14** Dept admin on another department: `404` for single-record reads, `403` for actions. [A] CSE admin → EEE: 403 on actions, 404 on reads (via `hideExistence` policy; room/teacher endpoints arrive in specs 05/06, so tested here with the policy helper and every endpoint added here).
15. Permissions table: department CRUD, admin grants, resets, user search are super-admin only (active state, role, and the right account state).
16. CLAUDE.md: all through `can()`; audit in the same transaction; last-super-admin guard race-safe; partial unique index for duplicate active grants; no email/phone in any response (search returns name, department, kind only); Zod on every input; strings in i18n.

## Blockers / open questions

None block building. Decisions I'm taking (tell me if you disagree):
- **Hooks for later specs.** Sections, rooms, teachers and routines don't exist yet. `organisation` exposes `registerDepartmentUsage({ codeLocked, inUseBySemester })` (same pattern as `registerProfileExtras`). Default: both false. Auth registers the teacher check (a teacher with `department_id`); sections/rooms/routines register in specs 04/05/07. DEP-03 and DEP-02 tests inject a fake usage provider.
- **Where code lives.** `UserRole` belongs to `auth`, so role grant/remove/reset code goes in `auth` (`adminRoles.service.js`); department CRUD and the coverage job go in `organisation`. Direction stays auth → organisation (no new import cycle); auth looks up departments through organisation's exports.
- **Reset password** sends a `reset_password` link (1 h) to the admin's own email and ends their sessions; **reset second step** clears `totp_secret_enc`/`totp_enabled_at` and ends their sessions (setup is forced at next sign-in because admins always need the second step).
- **Alert once per department:** `department.admin_alert_sent_at`, set when the alert goes out and cleared when an active admin exists again.
- **"Active admin"** = a `dept_admin` role with no `ended_at` on an account in state `active`. `loadRequestUser`/profile role lookups must ignore ended roles.
- **Spec index note:** the spec's partial unique index `{user_id, role, department_id}` (where `ended_at` absent) is used as written; section-scoped roles (CR/DCR, spec 09) will need their own handling then.

## Files

**shared/**
- `enums.js`: nothing new. `errors.js`: add `LAST_SUPER_ADMIN` (409), `CODE_LOCKED` (409), `DEPARTMENT_IN_USE` (409), `USER_NOT_ELIGIBLE` (422/409).
- `schemas/departments.js` (+ export): `departmentCode` (`/^[A-Z]{2,10}$/`), `createDepartmentBody`, `updateDepartmentBody` (strict, at least one field), `grantAdminBody` (`user_id`, `role`, `department_id` required iff `dept_admin`, forbidden for `super_admin`), `userSearchQuery`, id params.
- `__tests__/shared.test.js`: schema cases.

**server/src/modules/organisation/**
- `organisation.model.js`: add `Department` (below).
- `department.service.js`: `listActiveDepartments`, `createDepartment`, `updateDepartment`, `retireDepartment`, `getDepartment`, `registerDepartmentUsage`, `isActiveDepartment` (real lookup; remove `setDepartmentLookup` stub and its callers' reliance).
- `department.controller.js`, `department.routes.js` (`departmentsPublicRouter` at `/api/departments`; admin router added into the existing `/api/admin` mount).
- `coverage.service.js` + `coverage.jobs.js`: `admin.coverage_check`; `listDepartmentsWithoutAdmin()` exported for spec 18.
- `organisation.policy.js`: add `department.manage`, `department.view_admin_list`.
- `organisation.schemas.js` / `index.js`: wire exports.

**server/src/modules/auth/**
- `auth.model.js`: extend `UserRole` (`granted_by`, `granted_at`, `ended_at`, `ended_by`, indexes from the spec incl. the partial unique one).
- `auth.service.js`: `loadRequestUser` and `seedSuperAdmin` use only roles with no `ended_at`; seed sets `granted_at`. `profile.service.js` role lookup the same.
- `adminRoles.service.js`: `listAdmins`, `grantAdminRole`, `removeAdminRole` (guard document + transaction), `resetAdminPassword`, `resetAdminSecondStep`, `searchEligibleUsers`, `activeAdminCount`, `findDepartmentsWithoutActiveAdmin`.
- `adminRoles.controller.js`, `adminRoles.routes.js` (under `/api/admin`).
- `auth.policy.js`: add `admin_role.manage`, `admin_account.reset`, `admin_user.search` (active super admin; "not self" is checked in the service against the target).
- `auth.model.js`: a `UserRoleGuard` single document (same pattern as `AllowedDomainGuard`) so concurrent removals can't leave zero super admins.
- `index.js`: export new services; register teacher department usage.

**server/src/**
- `app.js`: mount `/api/departments` (public, before auth) and the new admin routers.
- `server.js`: add `defineOrganisationJobs` to job registrars; schedule hourly `admin.coverage_check`.
- `modules/notifications/templates/index.js` + `i18n/en.json`: templates `no_active_admin`, `admin_password_reset` (reuses `reset_password` if wording fits), `admin_second_step_reset`, `admin_role_changed` (notice to the target).

**client/**
- `features/admin/api.js`, `hooks.js`; `lib/query-keys.js`: `departments`, `admins`, `userSearch`.
- `routes/admin/DepartmentsPage.jsx`, `routes/admin/AdminsPage.jsx`; components `DepartmentForm`, `AdminGrantDialog` (account search → pick → role/department), `SuperAdminWarningBanner`.
- `App.jsx`: routes `/admin/departments`, `/admin/admins` (super admin only; server still enforces). `AppShell.jsx`: nav links for super admins.
- `i18n/en.json`: all new text. Sign-up teacher department select reads `GET /api/departments` if it doesn't already.

## Data model

- `department` (`organisation`): `code` (unique index, upper-case), `name`, `retired` (default false), `retired_at?`, `admin_alert_sent_at?`, `created_at`. Index `{ retired: 1, code: 1 }`.
- `user_role` (extended): as in spec; indexes `{ user_id:1, ended_at:1 }`, `{ role:1, department_id:1, ended_at:1 }`, partial unique `{ user_id, role, department_id }` with `partialFilterExpression: { ended_at: { $exists: false } }`. Ending a role sets `ended_at`/`ended_by` (never deleted).
- `user_role_guard`: one doc `{ _id: 'super_admin', version }`; granting/removing a role writes it first inside the transaction, so concurrent removals serialise and the "at least one active super admin" check is race-free.
- Transactions: grant = guard touch + eligibility + insert role + audit; removal = guard touch + count active super admins (counting only `active`, verified accounts) + end role + audit. Session end (`endAllSessions`) and emails run after commit.
- First-action-wins: removal ends the role with `findOneAndUpdate({ _id, ended_at: { $exists: false } })`; no match → `404`/already removed.

## API

All admin routes are behind `requireAuth`, validated with Zod, and call `assertCan` first.

| Route | Check | Notes / audit |
|---|---|---|
| `GET /api/departments` | public | active only; `{code,name,id}` |
| `POST /api/admin/departments` | `department.manage` | `CONFLICT` on dup code; audit `department.create` |
| `PATCH /api/admin/departments/:id` | `department.manage` | `CODE_LOCKED`, `CONFLICT`; audit `department.rename` |
| `POST /api/admin/departments/:id/retire` | `department.manage` | `DEPARTMENT_IN_USE`; audit `department.retire` |
| `GET /api/admin/admins` | `admin_role.manage` | admin accounts + active roles + department name; includes `super_admin_count` and `warning: fewer_than_two_super_admins` |
| `POST /api/admin/admins` | `admin_role.manage`, not self | `USER_NOT_ELIGIBLE`, `CONFLICT`, `FORBIDDEN`; audit `admin_role.grant` (role, department); ends target sessions |
| `DELETE /api/admin/admins/:roleId` | `admin_role.manage`, not self | `LAST_SUPER_ADMIN`; audit `admin_role.remove`; ends sessions; triggers coverage check |
| `POST /api/admin/admins/:userId/reset-password` | `admin_account.reset`, not self, target must hold an admin role | 202; audit `admin.password_reset` |
| `POST /api/admin/admins/:userId/reset-second-step` | same | 200; audit `admin.second_step_reset` |
| `GET /api/admin/users/search?q=` | `admin_user.search` | active + verified only; returns id, name, department_id/name, kind — no email/phone |

`DEP-14`: new policy option reuse — single-record admin reads use `{ hideExistence: true }`; actions use the normal 403. Every endpoint here is super-admin only, so a dept admin gets 403 on all; tested.

## UI

- Departments page: table (code, name, status), create/rename/retire (confirm), inline error text for `CONFLICT`, `CODE_LOCKED`, `DEPARTMENT_IN_USE`.
- Admins page: list with role chips and department; "Grant" dialog (debounced search → select → role + department); remove (confirm; `LAST_SUPER_ADMIN` message), reset password / reset second step buttons (hidden on own row; server enforces); warning banner when fewer than two super admins.
- Keys under `admin.departments.*`, `admin.admins.*`, `errors.LAST_SUPER_ADMIN` etc. Mobile-first at 360 px, labelled inputs, focus-managed dialogs.
- Account-state screens unchanged (admin routes only after sign-in and second step).

## Tests

(Vitest + Supertest + in-memory replica set; test names start with the requirement ID.)

- Unit/shared: `departmentCode` and body schemas (1, 5, 6).
- `organisation/__tests__/departments.api.test.js`: DEP-01 (dup → CONFLICT, bad code → VALIDATION_ERROR, concurrent creates → one 201), DEP-02 (rename ok; `CODE_LOCKED` via fake usage provider), DEP-03 (retire; in-use refused; hidden from list; history kept), DEP-04 (public list, active only), permissions (dept admin/teacher/student/anonymous refused).
- `auth/__tests__/adminRoles.api.test.js`: DEP-05, DEP-06 (ineligible states `email_unverified`/`pending`/`deactivated`/unverified → `USER_NOT_ELIGIBLE`; teacher keeps teacher role; duplicate grant → `CONFLICT`), DEP-07 (last super admin; two simultaneous removals leave one), DEP-08 (self grant/remove/reset → FORBIDDEN), DEP-09 (old session `UNAUTHENTICATED`; new sign-in asks second step), DEP-10 (audit rows contain who/role/department, no email), DEP-11 (reset password email goes to the admin's own address; second step cleared; sessions ended; not on self; non-admin target refused), search returns no email/phone.
- `organisation/__tests__/coverage.test.js`: DEP-12 (removing the only admin emails every super admin once; second run sends nothing; recovers after a new admin; deactivated admin counts as no admin; job idempotent).
- `policy/__tests__/can.test.js` additions: DEP-13 (`isAdminOf` and ended roles ignored), DEP-14 (`hideExistence` → 404 for reads, 403 for actions).
- Cross-scope: every role (dept admin, teacher, student, CR, anonymous, `email_unverified`) is refused on every endpoint above.
- Client: component tests for Departments and Admins pages (renders, error mapping, self-row hides reset/remove, banner), Playwright smoke only if requested.

Mapping: checklist 1–14 ↔ the test IDs above; 15–16 ↔ the cross-scope and privacy tests.

## Build order

1. Shared errors + schemas + tests.
2. `Department` model, `department.service`, public list, policy; tests (1–4, 15).
3. Extend `UserRole` + role filtering in `loadRequestUser`/profile; update seed; keep existing auth tests green.
4. Admin roles: guard, grant, remove, list, search, session end, audit; tests (5–10, 13, 14).
5. Password/second-step reset + templates; tests (11).
6. Coverage service, job, hourly schedule, mail template, `listDepartmentsWithoutAdmin`; tests (12).
7. Replace the `setDepartmentLookup` stub; register teacher usage hook; wire `app.js`/`server.js`.
8. Client: api/hooks, pages, banner, routes, nav, i18n; component tests.
9. `run-checks` (lint, tests, build); walk the checklist.

## Out of scope

Admin dashboard screen and the "Departments without an active admin" card (spec 18, only the data function is exported), deactivating/suspending users (specs 06/18, they just call the coverage check later), the audit log viewer, rooms/teachers/sections endpoints for DEP-14's room example (specs 05/06/04/07), Bangla translations.

## Departures from the plan (recorded during implementation)

- **Coverage code lives in `auth`, not `organisation`** (`adminRoles.service.js`, `adminRoles.jobs.js`): it needs `UserRole` and the mail queue, and `organisation` must not import `auth` (no cycle). `organisation` exports `listDepartmentsForCoverage`, `claimAdminAlert`, `clearAdminAlert`.
- **Partial unique index uses `ended_at: null`.** MongoDB rejects `$exists: false` in a partial index, so `ended_at` defaults to `null` and the filter is `{ ended_at: { $type: 'null' } }`. Queries use `ended_at: null`.
- **Job** `admin.coverage_check` is scheduled hourly in `server.js` and also runs straight after every role change.
- **Existing tests updated**: sign-up/verify tests now create a real department (the `setDepartmentLookup` stub is gone); the error-code list test includes the four new codes.
- **Client**: no dialog component exists in `components/ui`, so the grant flow is an inline panel and confirmations use `window.confirm`.
