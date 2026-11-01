# 18: Admin dashboard

R1 · Status: Draft · Depends on: 03–17 · PRD: Admin dashboard and controls, Core features (F5, F5a), CR/DCR dashboard (Checks on CR power), Student ID claim (revocation) · Diagrams: 01-use-case, 24-sitemap

## Goal

One home page per admin showing everything that needs attention in their scope (a department admin sees their department, a super admin sees everything with a department filter), plus the management screens not covered elsewhere: students, flags, appeals and the audit log.

## Scope

**In:** the dashboard cards, student management (search, deactivate, reactivate, mark graduated or undo, admin password reset fallback, set group), flags and appeals handling, the audit log viewer, cross-department notices (sections created by another department's import, duplicate warnings).

**Out:** screens owned by other specs, which the dashboard links to: teachers (06), semesters and readiness (04, 14), import and edit (07, 08), CR/DCR (09), rooms (05), calendar (11), departments and admins (03), room requests (19).

## Requirements

### Cards (newest first; each links to its screen)
- **ADM-01** **Teacher registrations waiting** (spec 06), with approve and reject inline.
- **ADM-02** **ID claims that need the admin**: escalated join requests (spec 10 JR-14), CR/DCR own claims (JR-18), and UV ID conflicts.
- **ADM-03** **Reports from CR and DCR**: open flags (spec 17). Removal requests come in a later release.
- **ADM-04** **Rejected join requests and appeals**: rejections by CR/DCRs (spec 10 JR-12) with open appeals first. This is the check on CR power. Members removed from section groups appear here from R3.
- **ADM-05** **Routine problems**: open errors and warnings from the department's latest import, plus cross-department duplicate warnings raised by another department's import (spec 07 IMP-18), and sections created by another department's import (IMP-27).
- **ADM-06** **Room requests waiting** (from R2, spec 19).
- **ADM-07** **Current semester**: name and status, and if a draft exists, the readiness checklist (spec 14). The super admin sees every department and the "Make current" button.
- **ADM-08** **Departments without an active admin** (super admin only, spec 03), and a warning if fewer than two super admins exist.
- **ADM-09** **Unconfirmed students** per section, counting those unconfirmed 14+ days after the semester became current (spec 14 ROL-12).
- **ADM-10** **Recent activity**: the latest 20 audit entries in scope.
- **ADM-11** `GET /api/admin/dashboard?department_id=` returns all card data in one call, scoped by `isAdminOf`. A department admin passing another department → `403`.

### Student management
- **ADM-12** Search students of the department by name or UV ID (results: name, photo, UV ID, section, group, state, email status `verified` / `unverified` / `bouncing`, never the address).
- **ADM-13** Deactivate a student (reason required, confirmation on the client). They can't sign in, all sessions end, and history is kept. Reactivate restores the previous state (`active` if they have an accepted enrolment for the current semester, otherwise `unconfirmed` or `claim_pending`).
- **ADM-14** Mark a student graduated, or reverse a graduation (back to `unconfirmed`).
- **ADM-15** Admin password reset fallback, for a student whose email no longer works: the admin sets a temporary password shown once. The student must change it at next sign-in. All sessions end. Audited.
- **ADM-16** Set a student's group by hand (spec 10 JR-17), revoke a UV ID claim (JR-19), decide appeals (JR-20).
- **ADM-17** Nothing is hard-deleted. Every action here is audited with old and new values.

### Flags
- **ADM-18** The admin sees open flags with who raised them and when, and marks each `fixed` or `rejected` with a reply (1–1,000 characters). The CR/DCRs of the section see the result (spec 17).

### Audit log
- **ADM-19** The audit log viewer lists entries with filters (date range, action, actor, target). A department admin sees only entries whose `scope_department_id` is their department. A super admin sees all. The log is read-only, and there is no edit or delete control anywhere.
- **ADM-20** Viewing reported chat messages is itself audited (from R3, spec 22).

### General rules
- **ADM-21** Destructive actions (deactivate, remove a role, publish a routine, make a semester current, revoke a claim) require a confirmation dialog on the client.
- **ADM-22** No admin screen ever shows a user's private messages, phone, or email address (except the two allowed exceptions in specs 06 and 10).

## Permissions

| Action | Dept admin | Super admin |
|---|---|---|
| Dashboard cards | own dept | all, with filter |
| Student management | own dept's students | all |
| Flags, appeals | own dept | all |
| Audit log | own dept's entries | all |
| Departments-without-admin card | ✘ | ✔ |

## Data

- `user.must_change_password` (bool) for ADM-15.
- `user.state_before_deactivation` for ADM-13.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/admin/dashboard` | admin | `?department_id=` | all cards | `FORBIDDEN` |
| `GET /api/admin/students?q=&department_id=` | admin | none | search results | none |
| `POST /api/admin/students/:id/deactivate` | admin of dept | reason | 200 | none |
| `POST /api/admin/students/:id/reactivate` | admin of dept | none | 200 | none |
| `POST /api/admin/students/:id/graduate` | admin of dept | none | 200 | none |
| `POST /api/admin/students/:id/ungraduate` | admin of dept | none | 200 | none |
| `POST /api/admin/students/:id/temp-password` | admin of dept | none | `{ temp_password }` (once) | none |
| `GET /api/admin/flags?status=` | admin | none | list | none |
| `POST /api/admin/flags/:id/resolve` | admin of dept | status, reply | 200 | `ALREADY_DECIDED` |
| `GET /api/admin/audit?from=&to=&action=&actor_id=&target_id=` | admin | none | paged entries | none |

## Screens

Admin home (cards), Students page (search + actions), Flags page, Appeals and rejections page, Audit log page. The navigation links to the other specs' screens.

## Acceptance tests

- ADM-11: a CSE admin requesting `?department_id=<EEE>` → `403`. The super admin sees both.
- ADM-12: search results contain an email status but no address.
- ADM-13: a deactivated student's open session is ended, reactivation restores `active` when they have an accepted enrolment.
- ADM-15: after a temporary password, the student's next sign-in returns `next: 'change-password'`.
- ADM-18: resolving a flag twice → `ALREADY_DECIDED`.
- ADM-19: a CSE admin's audit query never returns an EEE entry. There is no endpoint that updates or deletes audit entries.

## Decisions and open questions

- **Decision:** the admin password fallback uses a one-time temporary password (ADM-15), because the student's email doesn't work.
- **Decision:** reactivation restores the state from before deactivation, adjusted for the current semester.

## Tasks

- [ ] Dashboard aggregation service (one scoped query per card)
- [ ] Student management endpoints + session end + audit
- [ ] Temporary password + forced change in `/me` `next`
- [ ] Flags resolve endpoint
- [ ] Audit log query with scope filter + paging
- [ ] Admin pages
- [ ] Tests (scope for every endpoint)
