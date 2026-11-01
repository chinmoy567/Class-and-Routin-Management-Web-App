# 03: Departments and admins

R1 · Status: Draft · Depends on: 01 · PRD: Users & roles, Admin dashboard and controls (Who the admins are, Super admin only, Rules), Core features (F5b) · Diagrams: 02-role-hierarchy

## Goal

Super admins keep the list of departments and decide who is an admin. Every admin action is limited to the admin's scope, there are always at least two super admins, and a department without an admin is noticed and can be recovered.

## Scope

**In:** create, rename and retire departments; grant and remove `dept_admin` and `super_admin` roles; the last-super-admin guard; resetting another admin's password or second step; the no-active-admin alert.

**Out:** the admin dashboard screen (spec 18), deactivating ordinary users (spec 18), the audit log viewer (spec 18).

## Requirements

### Departments
- **DEP-01** A super admin can create a department with a code (2–10 upper-case letters, unique, for example `CSE`) and a name.
- **DEP-02** A super admin can rename a department. The code can't change once any section, room, teacher or routine refers to it.
- **DEP-03** A super admin can retire a department. A retired department disappears from the join form and the teacher sign-up list, but its history stays. It can't be retired while it is used by a section of the current or draft semester.
- **DEP-04** `GET /api/departments` (public, used by sign-up) lists active departments with code and name.

### Admin roles
- **DEP-05** A super admin can grant `dept_admin` (for one department) to an existing account that is `active` and has a verified email. A teacher account keeps its teacher role and gains the admin role.
- **DEP-06** A super admin can grant `super_admin` to an existing `active`, verified account.
- **DEP-07** A super admin can remove either role. Removing `super_admin` is refused if it would leave fewer than one active super admin (`409 LAST_SUPER_ADMIN`). The dashboard warns whenever fewer than two exist.
- **DEP-08** Nobody can grant or remove a role on their own account. Admin roles are never granted through sign-up.
- **DEP-09** Granting or removing an admin role ends the target's existing sessions, so the new second-step and timeout rules apply at once (spec 01 AUTH-17, AUTH-22).
- **DEP-10** Every grant and removal is audited with who, when, the role and its department.

### Recovery
- **DEP-11** A super admin can reset a department admin's password (sends a reset link to the admin's own email) or second step (clears TOTP, forcing setup at next sign-in). A super admin can do the same for another super admin, but never for themselves. Each reset is audited.
- **DEP-12** If a department has no active `dept_admin` (role removed, account deactivated or suspended), every super admin is emailed at once, and the department appears in the "Departments without an active admin" card (spec 18). A super admin can act in that department meanwhile, since super admins can do anything a department admin can.

### Scope enforcement
- **DEP-13** `isAdminOf(user, departmentId)` is true for any super admin, and for a department admin only of their own department. Every admin policy in every module uses it.
- **DEP-14** A department admin calling any admin endpoint for another department gets `404 NOT_FOUND` for reads of single records, and `403 FORBIDDEN` for actions.

## Permissions

| Action | Super admin | Dept admin | Others |
|---|---|---|---|
| Create, rename, retire department | ✔ | ✘ | ✘ |
| List departments | ✔ | ✔ | ✔ (public list) |
| Grant/remove `dept_admin`, `super_admin` | ✔ (not on self) | ✘ | ✘ |
| Reset another admin's password or second step | ✔ (not on self) | ✘ | ✘ |

## Data

- `department`: code (unique), name, retired (bool), created_at.
- `user_role`: user_id, role (`super_admin` | `dept_admin` | `teacher` | `cr` | `dcr`), department_id?, section_id?, semester_id?, granted_by, granted_at, ended_at?, ended_by?. A role is in effect when `ended_at` is empty. Indexes: `{ user_id: 1, ended_at: 1 }`, `{ role: 1, department_id: 1, ended_at: 1 }`, and a partial unique index on `{ user_id, role, department_id }` where `ended_at` doesn't exist (no duplicate active grant).

Removed roles are ended, not deleted, so history stays.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/departments` | anyone | none | active list | none |
| `POST /api/admin/departments` | super admin | code, name | 201 | `CONFLICT` |
| `PATCH /api/admin/departments/:id` | super admin | name?, code? | 200 | `CODE_LOCKED`, `CONFLICT` |
| `POST /api/admin/departments/:id/retire` | super admin | none | 200 | `DEPARTMENT_IN_USE` |
| `GET /api/admin/admins` | super admin | none | admin accounts and roles | none |
| `POST /api/admin/admins` | super admin | user_id, role, department_id? | 201 | `USER_NOT_ELIGIBLE`, `CONFLICT`, `FORBIDDEN` (self) |
| `DELETE /api/admin/admins/:roleId` | super admin | none | 204 | `LAST_SUPER_ADMIN`, `FORBIDDEN` (self) |
| `POST /api/admin/admins/:userId/reset-password` | super admin | none | 202 | `FORBIDDEN` |
| `POST /api/admin/admins/:userId/reset-second-step` | super admin | none | 200 | `FORBIDDEN` |
| `GET /api/admin/users/search?q=` | super admin | none | verified accounts (name, department, kind; no email) for picking a new admin | none |

## Jobs and events

- `admin.coverage_check`: runs after any role or account-state change, plus hourly as a safety net. Emails super admins when a department has no active admin (once per department until it is fixed).

## Screens

Departments list (create, rename, retire), Admins list (grant via account search, remove, reset password, reset second step), warning banner when fewer than two super admins exist.

## Acceptance tests

- DEP-01: a duplicate code → `CONFLICT`.
- DEP-03: retiring a department with a section in the draft semester → `DEPARTMENT_IN_USE`.
- DEP-05: granting `dept_admin` to an `email_unverified` account → `USER_NOT_ELIGIBLE`.
- DEP-07: with exactly one super admin left, removing it → `409 LAST_SUPER_ADMIN`.
- DEP-08: a super admin removing their own role → `FORBIDDEN`.
- DEP-09: after a grant, the target's old session gets `UNAUTHENTICATED`, and their next sign-in asks for the second step.
- DEP-12: removing a department's only admin emails every super admin once.
- DEP-14: a CSE admin creating a room in EEE → `403`. Reading an EEE teacher → `404`.

## Decisions and open questions

- **Decision:** roles are ended instead of deleted (`ended_at`), for history and audit.
- **Decision:** "at least two super admins" is a warning, not a block, because the system starts with one (spec 00 seed). The hard rule is that the last one can't be removed.

## Tasks

- [ ] `department` and `user_role` models and indexes
- [ ] `isAdminOf` + `hasRole` scope helpers wired into `can()`
- [ ] Department CRUD + retire guard
- [ ] Grant/remove admin roles with guards, session end, audit
- [ ] Admin password and second-step reset
- [ ] Coverage-check job + email
- [ ] Screens
- [ ] Tests, including cross-department access for every admin endpoint added here
