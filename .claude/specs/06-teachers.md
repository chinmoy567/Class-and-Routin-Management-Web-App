# 06: Teachers

R1 · Status: Draft · Depends on: 03 · PRD: Teacher approval, Teacher dashboard (Account, Rules), Admin dashboard and controls (Teachers), Core features (F4a) · Diagrams: 10-activity-teacher-approval, 19-state-account

## Goal

A teacher who signs up is held as `pending` until their department's admin approves them. Once approved, the admin links the account to the teacher's **department + short code** from the routine sheet, so the teacher's own classes appear. The admin can later suspend or remove a teacher.

## Scope

**In:** the teacher registration queue, approve and reject, re-applying after rejection, linking and unlinking short codes, suspend, reactivate and remove, the `teacher` directory records (department, short code, full name).

**Out:** sign-up and verification (spec 01), creating teacher directory records from the import's teacher sheet (spec 07, which uses this module's service), the teacher dashboard (spec 16).

## Requirements

### Registration and approval
- **TCH-01** When a teacher verifies their email (spec 01), a `teacher_registration` is created as `pending`, with the department and requested short code from sign-up.
- **TCH-02** The admin of that department sees pending registrations with full name, **email** (one of the two allowed exceptions to the privacy rule), department, requested short code, the date, and any earlier rejections of the same account (with reasons).
- **TCH-03** Approving changes the registration to `approved` and the account from `pending` to `active`, grants the `teacher` role for that department, and emails the teacher. It uses "first action wins" (`findOneAndUpdate` on `status: 'pending'`), so two admins can't both decide.
- **TCH-04** Rejecting needs a reason (5–500 characters). The registration becomes `rejected` and the teacher is emailed with the reason. The account stays `pending`, and on sign-in the teacher sees the rejection and an "apply again" button.
- **TCH-05** "Apply again" lets the teacher correct the department and short code and creates a new `pending` registration. Only one pending registration per account (partial unique index).
- **TCH-06** Approval and rejection are audited.

### Short-code linking
- **TCH-07** A `teacher` record is department + short code + full name. `(department_id, short_code)` is unique. Records come from the import's teacher sheet (spec 07) or are added by the admin by hand.
- **TCH-08** The admin of department D can link an `active` teacher account to a teacher record of D. The same record can't be linked to two accounts (`teacher.user_id` set means linked). Approving can link in the same step if a record matching the requested short code exists.
- **TCH-09** If the same short code appears twice in one department's teacher list, the code can't be linked until the admin fixes the import (`SHORT_CODE_AMBIGUOUS`). This can only happen inside a staged import, because the unique index prevents it in saved records. Spec 07 reports it as an error.
- **TCH-10** The admin can unlink. Linking and unlinking are audited and invalidate the teacher's routine cache (spec 12).
- **TCH-11** Until an account is linked, the teacher's dashboard shows "Your account is not linked to a short code yet. Ask your department admin." and My routine is empty.

### Suspend and remove
- **TCH-12** The admin can **suspend** an active teacher (they can't sign in, reversible) or **remove** them (state `deactivated`, history kept). Both end all the teacher's sessions (spec 01 AUTH-23). A reason is required and the action is audited.
- **TCH-13** The admin can reactivate a suspended or deactivated teacher back to `active`.
- **TCH-14** Removing a teacher doesn't change the routine. Their slots keep the short code and still show the full name from the teacher record.

### Teacher directory
- **TCH-15** `teachers.findByCode(departmentId, shortCode)` and `teachers.fullNames(ids)` are exported for routine modules. `TBA` is a reserved code meaning "Teacher to be announced" and is never a record.
- **TCH-16** "Sections a teacher teaches" = sections with at least one published slot in the current semester assigned to any teacher record linked to the account. It is always computed on the server (`teachers.sectionsTaughtBy(userId)`).

## Permissions

| Action | Admin of dept | Super admin | Others |
|---|---|---|---|
| View pending registrations (with email) | own dept | all | ✘ |
| Approve / reject | own dept | ✔ | ✘ |
| Link / unlink, suspend, remove, reactivate | own dept | ✔ | ✘ |
| Add / edit teacher records by hand | own dept | ✔ | ✘ |
| Apply again | the rejected teacher | n/a | n/a |

## Data

- `teacher_registration`: user_id, department_id, requested_short_code, status (`pending` | `approved` | `rejected`), reason?, decided_by?, decided_at?, created_at. Partial unique `{ user_id: 1 }` where `status: 'pending'`.
- `teacher`: department_id, short_code (upper-case), full_name, user_id?, created_from (`import` | `manual`). Unique `{ department_id, short_code }`, plus a partial unique `{ user_id, department_id }` where `user_id` is an ObjectId (see Decisions).

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/admin/teacher-registrations?status=pending` | admin | none | list | none |
| `POST /api/admin/teacher-registrations/:id/decision` | admin of dept | decision (`approve` / `reject`), reason?, teacher_id? | 200 | `ALREADY_DECIDED`, `VALIDATION_ERROR` |
| `POST /api/me/teacher-registration` | rejected teacher (`pending`) | department_id, short_code | 201 | `CONFLICT` (already pending) |
| `GET /api/admin/teachers?department_id=` | admin | none | records with link status | none |
| `POST /api/admin/teachers` | admin of dept | department_id, short_code, full_name | 201 | `CONFLICT` |
| `PATCH /api/admin/teachers/:id` | admin of dept | full_name | 200 | none |
| `POST /api/admin/teachers/:id/link` | admin of dept | user_id | 200 | `CONFLICT` (already linked), `USER_NOT_ELIGIBLE` |
| `POST /api/admin/teachers/:id/unlink` | admin of dept | none | 200 | none |
| `POST /api/admin/teacher-accounts/:userId/suspend` | admin of dept | reason | 200 | none |
| `POST /api/admin/teacher-accounts/:userId/remove` | admin of dept | reason | 200 | none |
| `POST /api/admin/teacher-accounts/:userId/reactivate` | admin of dept | none | 200 | none |

## Jobs and events

- Emails: `teacher_approved`, `teacher_rejected` (spec 15).
- The dashboard digest picks up pending registrations (spec 15).

## Screens

Teacher registrations card and page (admin), Teachers page (records, link status, link/unlink, suspend/remove), Teacher waiting screen (pending), Teacher rejected screen with "apply again" form.

## Acceptance tests

- TCH-03: two admins approving at once → one `200`, one `409 ALREADY_DECIDED`.
- TCH-04: rejecting without a reason → `VALIDATION_ERROR`.
- TCH-05: a teacher re-applies after rejection, and the admin's list shows the earlier rejection with its reason.
- TCH-08: linking `CSE:AR` to a second account → `CONFLICT`. `AR` in CSE and `AR` in CE can both be linked to different accounts.
- TCH-12: a suspended teacher signing in → `ACCOUNT_DISABLED`, and their open session is gone.
- TCH-16: a teacher who teaches only CSE 2-II-A gets `404` for the roster of CSE 2-II-B (checked in spec 16).
- A CSE admin deciding an EEE registration → `403`.

## Decisions and open questions

- **Decision (data model change):** the PRD makes `teacher.user_id` unique when set, but its Open question 4 asks whether one account can be linked to short codes in two departments. This spec makes `(user_id, department_id)` unique instead, which allows one link per department and works whichever way Open question 4 is answered. If the answer is "no", add a check that refuses a second department.
- **Decision:** a rejected teacher stays `pending` with a rejected registration rather than getting a new account state. The PRD lists no "rejected" teacher state.
- **Open (PRD Open question 4):** can one teacher account be linked in two departments?

## Tasks

- [ ] `teacher_registration` and `teacher` models + indexes
- [ ] Create registration on verification (hook from spec 01)
- [ ] Decision endpoint with first-action-wins, role grant, emails, audit
- [ ] Apply-again endpoint
- [ ] Teacher records CRUD, link/unlink
- [ ] Suspend/remove/reactivate with session end
- [ ] Exported directory functions (`findByCode`, `fullNames`, `sectionsTaughtBy`)
- [ ] Screens
- [ ] Tests
