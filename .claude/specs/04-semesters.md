# 04: Semesters

R1 · Status: Done · Depends on: 03 · PRD: Glossary (Semester), Semesters and student updates (Semester states), Admin dashboard and controls (Semesters) · Diagrams: 22-state-semester-section

## Goal

Semesters exist as named periods with dates and a state. Everything semester-bound (sections, routines, CR/DCR roles, enrolments) hangs off one. This spec covers creating and editing semesters. Making a draft current (the rollover) is spec 14.

## Scope

**In:** create a draft semester, edit its name and dates, list semesters, read the current one, the "at most one current" rule, the semester context used by other modules.

**Out:** the readiness checklist and the "make current" step (spec 14), archiving as part of rollover (spec 14).

## Requirements

- **SEM-01** A super admin creates a semester with a name (unique, for example "Spring 2027"), a start date and an end date (end after start). It starts as `draft`.
- **SEM-02** States are `draft` → `current` → `archived` only. No other transitions. At most one semester is `current` (partial unique index) and at most one is `draft` at a time.
- **SEM-03** A super admin can edit the name and dates of a draft or current semester. Changing the dates of the current semester is audited and sends `calendar.changed` (live status depends on the dates).
- **SEM-04** A draft with nothing attached (no sections, events or roles) can be deleted by a super admin. Otherwise it can't be deleted.
- **SEM-05** `semesters.current()` and `semesters.draft()` are exported service functions. Other modules use them instead of querying the collection.
- **SEM-06** Students and teachers never see a draft semester or anything attached to one. Admins see the draft in their admin screens.
- **SEM-07** Bootstrapping: the very first semester can be made current directly by a super admin (spec 14 covers the normal rollover). This creates no unconfirmed students, because nobody is active yet.

## Permissions

| Action | Super admin | Dept admin | Others |
|---|---|---|---|
| Create, edit, delete draft | ✔ | ✘ | ✘ |
| List all semesters | ✔ | ✔ (read) | ✘ |
| Read current semester name and dates | ✔ | ✔ | ✔ (signed in) |

## Data

- `semester`: name (unique), status (`draft` | `current` | `archived`), start_date, end_date (`YYYY-MM-DD`), made_current_at?, made_current_by?, archived_at?. Indexes: partial unique `{ status: 1 }` where `status: 'current'`, and another where `status: 'draft'`.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/semesters/current` | signed in | none | `{ name, start_date, end_date }` or `null` | none |
| `GET /api/admin/semesters` | any admin | none | list, newest first | none |
| `POST /api/admin/semesters` | super admin | name, start_date, end_date | 201 | `CONFLICT` (name, or a draft exists), `VALIDATION_ERROR` |
| `PATCH /api/admin/semesters/:id` | super admin | name?, start_date?, end_date? | 200 | `SEMESTER_ARCHIVED`, `VALIDATION_ERROR` |
| `DELETE /api/admin/semesters/:id` | super admin | none | 204 | `SEMESTER_IN_USE` |
| `POST /api/admin/semesters/:id/bootstrap-current` | super admin | none | 200 | `CONFLICT` (a current semester already exists) |

## Jobs and events

- `calendar.changed` to everyone when the current semester's dates change.

## Screens

Semesters list (create draft, edit, delete) in the admin area. The current semester's name is shown in the app header.

## Acceptance tests

- SEM-02: creating a second draft while one exists → `CONFLICT`. Two concurrent bootstrap calls → exactly one semester is current.
- SEM-03: an end date before the start date → `VALIDATION_ERROR`.
- SEM-04: deleting a draft that has a section → `SEMESTER_IN_USE`.
- SEM-06: a student calling any endpoint with a draft semester's id gets `NOT_FOUND`.
- SEM-07: bootstrap is refused once any semester has been current.

## Decisions and open questions

- **Decision:** only one draft at a time. The PRD describes one draft per break, and one draft keeps the readiness checklist unambiguous.
- **Decision:** a direct bootstrap action for the very first semester (SEM-07). The PRD's rollover assumes an old semester exists.

## Tasks

- [x] `semester` model + indexes
- [x] Service with `current()` / `draft()` and the state rules
- [x] Admin endpoints + audit
- [x] Bootstrap endpoint (allowed only when no semester has ever been current)
- [x] Screens
- [x] Tests
