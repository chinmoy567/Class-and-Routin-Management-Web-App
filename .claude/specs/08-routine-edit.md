# 08: Routine edit

R1 · Status: Draft · Depends on: 07 · PRD: Routine edit page, Sessional groups, Routine file import (Who owns a slot) · Diagrams: 12-activity-routine-import

## Goal

After an import, the department admin fixes or changes single slots on a web page instead of uploading a new file. The page uses the same checks as the import and only touches the admin's own department's slots.

## Scope

**In:** the routine edit grid, adding, editing and deleting a slot, adding a section or group by hand, conflict checks, the approved-booking warning, audit, notifications.

**Out:** bulk changes (re-import, spec 07).

## Requirements

- **EDT-01** The page shows one section (department + level + term + letter) of a chosen semester as a weekly grid (Sunday–Thursday), laid out the way students see it. Slots owned by another department appear greyed out with that department's code and can't be edited.
- **EDT-02** The admin of department D can **add** a slot owned by D to any section of the semester (its own or another department's batch), with group (optional), day, start, end, course code, course name (optional), teachers (`DEPT:CODE` list or TBA) and room.
- **EDT-03** The admin can **edit** any field of a slot owned by D, or **delete** it. Editing or deleting another department's slot → `403 FORBIDDEN`.
- **EDT-04** Every add and edit runs the same checks as the import (spec 07): unknown teacher or room, missing fields, bad times or day are **errors** (the change can't be saved, `400 SLOT_INVALID` with the list). Teacher, room and section overlaps, TBA, outside 08:30–17:30, and cross-department duplicates are **warnings**. The client shows them, and the admin re-sends with `confirm_warnings: true`. Combined classes can be confirmed as in the import.
- **EDT-05** If the change puts a class in a room and time that has an **approved booking** on a future date (spec 19), the response lists the affected bookings with requester names. The admin chooses `keep_booking` (the class and booking both stay, and the requester is told) or `cancel_booking` (the booking is cancelled and the requester is emailed). Until spec 19 exists, there are never any bookings to warn about.
- **EDT-06** Edits to slots that came from an import set `edited_by_hand: true` (used by the re-import diff, spec 07).
- **EDT-07** The admin can add a section by hand (level, term, letter, for their own department) and add or rename groups of a section their department owns. A group can't be removed while a slot or an accepted enrolment uses it.
- **EDT-08** Every change is audited with old and new values. A change to a published slot is visible to students at once: the routine cache is cleared and `routine.changed` is sent. If the semester is current, affected students and teachers get a batched routine-change email (spec 15, combined per hour).
- **EDT-09** Optimistic concurrency: an edit sends the slot's `version`. If the slot changed since it was loaded, the server returns `409 CONFLICT` and the client reloads.
- **EDT-10** Only the admin of the owning department, or a super admin, can use this page. CR, DCR, teachers and students can't.

## Permissions

| Action | Admin of slot owner | Admin of another dept | Super admin | Others |
|---|---|---|---|---|
| View any section grid of the semester | ✔ | ✔ (read) | ✔ | ✘ |
| Add slot owned by own dept | ✔ | n/a | ✔ | ✘ |
| Edit / delete slot | ✔ | ✘ | ✔ | ✘ |
| Add section / groups (own dept batch) | ✔ | ✘ | ✔ | ✘ |

## Data

Uses `routine_slot`, `routine_slot_teacher`, `section` and `section_group` from spec 07. Adds `version` (number) to `routine_slot`.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/admin/semesters/:id/sections?department_id=` | admin | none | sections list | none |
| `GET /api/admin/sections/:id/routine` | admin | none | all published slots with owner | none |
| `POST /api/slots` | admin of D | slot fields, confirm_warnings?, booking_action? | 201 slot or 200 `{ warnings }` | `SLOT_INVALID`, `FORBIDDEN` |
| `PUT /api/slots/:id` | admin of owner | slot fields, version, confirm_warnings?, booking_action? | 200 | `SLOT_INVALID`, `CONFLICT`, `FORBIDDEN` |
| `DELETE /api/slots/:id` | admin of owner | version | 204 | `CONFLICT`, `FORBIDDEN` |
| `POST /api/admin/sections` | admin of dept | semester_id, department_id, level, term, letter | 201 | `CONFLICT` |
| `POST /api/admin/sections/:id/groups` | admin of dept | label | 201 | `CONFLICT` |
| `PATCH /api/admin/groups/:id` | admin of dept | label | 200 | `CONFLICT` |
| `DELETE /api/admin/groups/:id` | admin of dept | none | 204 | `GROUP_IN_USE` |

When there are unconfirmed warnings, a save returns `200 { data: { saved: false, warnings: [...] } }`, so the client can show them and re-send.

## Screens

Routine edit page: semester and section pickers, week grid, slot dialog (add/edit) with inline errors and a warnings confirmation step, delete confirmation, booking-clash dialog (keep or cancel).

## Acceptance tests

- EDT-03: a CSE admin editing a LAW-owned slot in LAW 1-II-A → `403`.
- EDT-04: saving a slot with an unknown room → `SLOT_INVALID`, and nothing changes. A teacher overlap returns warnings, and saves only with `confirm_warnings: true`.
- EDT-06: editing an imported slot sets `edited_by_hand`.
- EDT-07: deleting a group used by an accepted enrolment → `GROUP_IN_USE`.
- EDT-08: an edit in the current semester sends `routine.changed` to the section, and two edits within the hour produce one email per affected student.
- EDT-09: two admins editing the same slot → the second gets `409 CONFLICT`.

## Decisions and open questions

- **Decision:** warnings use a two-step save (`confirm_warnings`) rather than a separate endpoint.

## Tasks

- [ ] Reuse the import validators for one slot against saved slots
- [ ] Slot add/edit/delete service with versioning, ownership check, audit
- [ ] Section and group manual add/rename/delete
- [ ] Booking-clash hook (no-op until spec 19)
- [ ] Cache clear + events + batched email hook
- [ ] Routine edit page
- [ ] Tests
