# 14: Semester rollover

R1 · Status: Draft · Depends on: 09, 10 · PRD: Semesters and student updates, Admin dashboard and controls (Current semester readiness checklist), Core features (F1a), Acceptance criteria (Rollover), Account states and access · Diagrams: 13-activity-semester-rollover, 22-state-semester-section

## Goal

Moving from one semester to the next in one safe step. Department admins prepare the draft during the break. The super admin checks each department's readiness and makes the draft current. That archives the old semester, ends its CR/DCR roles, switches on the new ones, and makes every `active` student `unconfirmed` until their new join request is accepted.

## Scope

**In:** the readiness checklist, "make current", the semester update screen (the join form pre-filled, "I have completed my degree", "Not enrolled this semester"), the 14-day unconfirmed list, semester update reminders.

**Out:** creating the draft (spec 04), the join request mechanics (spec 10), section group creation and closing (spec 20 hooks).

## Requirements

### Readiness
- **ROL-01** For the draft semester, each department gets a readiness checklist: (a) at least one section exists, (b) a routine import is published with zero errors, (c) every section of the department has a CR assigned, (d) the department has at least one active room. Each item is ✔ or ✘ with a count ("3 of 8 sections have no CR").
- **ROL-02** Department admins see their department's checklist. The super admin sees all of them next to the "Make current" button.

### Make current
- **ROL-03** "Make current" needs a confirmation. If any department isn't ready, the confirmation names those departments ("EEE is not ready: no published routine"), and the super admin must confirm again.
- **ROL-04** In **one transaction**:
  1. the old current semester becomes `archived`,
  2. CR/DCR roles of the old semester end (`ended_at` = now),
  3. the draft becomes `current`,
  4. every `active` student becomes `unconfirmed`, and `confirmed_semester_id` stays as the old semester (history),
  5. the draft's CR/DCR roles take effect, and each CR/DCR gets an accepted enrolment and becomes `active` (spec 09 CRD-04),
  6. sections with a CR become open (spec 09 CRD-06).
  After commit: section groups of the old semester close and new ones are created for sections with a CR (spec 20 hooks), routine caches are cleared, `routine.changed` and `calendar.changed` are broadcast, and the rollover is audited with counts.
- **ROL-05** The transaction is idempotent and guarded: it runs only if the draft is still `draft` (conditional update). A second press → `ALREADY_DECIDED`.
- **ROL-06** A department that wasn't ready finishes its setup after the semester is current. Its sections open as soon as each gets a CR. Until then its students see "Your department is still setting up this semester" (spec 10 JR-03).
- **ROL-07** Because 6,000 students change state at once, the state change is one `updateMany`, not one write per student.

### Semester update screen
- **ROL-08** An `unconfirmed` student sees the semester update screen: the join form pre-filled with last semester's department and section letter, and the suggested next level and term (2-I → 2-II, 2-II → 3-I). The student can change everything except their approved UV ID.
- **ROL-09** A student whose last confirmed term was **4-II** also sees "I have completed my degree". Choosing it (with confirmation) makes the account `graduated`, with no join request. The admin can reverse it (spec 18).
- **ROL-10** "Not enrolled this semester" keeps the student `unconfirmed`, sets `not_enrolled_semester_id` = current, stops reminders, and keeps them off the overdue list until they send a join request.
- **ROL-11** An `unconfirmed` student can use their profile and one-to-one chat (R3) but not My routine, live status, rooms or the section group (the old group stays read-only).

### Follow-up
- **ROL-12** Students still unconfirmed 14 days after the semester became current, excluding "not enrolled", appear in the admin's "Unconfirmed students" list per section (spec 18). Nobody is locked out.
- **ROL-13** A semester update reminder email is sent to every `unconfirmed` student (excluding "not enrolled") when the semester becomes current, and again on day 7 and day 14 (spec 15). A CR/DCR can also send one reminder per student per day (spec 17).

## Permissions

| Action | Super admin | Dept admin | Student |
|---|---|---|---|
| See all readiness checklists, make current | ✔ | ✘ | ✘ |
| See own department's checklist | ✔ | ✔ | ✘ |
| Semester update screen, graduate, not enrolled | n/a | n/a | `unconfirmed` (graduate only after 4-II) |

## Data

- `user.not_enrolled_semester_id?`, `user.graduated_at?`.
- `semester.rollover_summary` { archived_semester_id, students_unconfirmed, roles_ended, roles_started, at, by }.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/admin/semesters/:id/readiness` | admins (dept: own only) | none | checklist per department | none |
| `POST /api/admin/semesters/:id/make-current` | super admin | confirm_not_ready?: string[] (department codes) | 200 summary | `NOT_READY_UNCONFIRMED` (lists depts), `ALREADY_DECIDED` |
| `GET /api/me/semester-update` | `unconfirmed` student | none | pre-filled form data, can_graduate | `STATE_NOT_ALLOWED` |
| `POST /api/me/graduate` | `unconfirmed` student after 4-II | none | 200 | `NOT_FINAL_TERM` |
| `POST /api/me/not-enrolled` | `unconfirmed` student | none | 200 | none |

## Jobs and events

- `semester.reminders`: daily at 09:00, sends the day-7 and day-14 reminders (idempotent, once per student per milestone).
- After commit hooks as in ROL-04.

## Screens

Readiness panel (admin dashboard card, spec 18) with "Make current" and the not-ready confirmation, Semester update screen (pre-filled join form + graduate + not-enrolled options), the old section group shown read-only.

## Acceptance tests

- [PRD] Given Spring 2027 is a draft with CSE ready and EEE not ready, when the super admin makes it current, then a warning names EEE. After confirming: all `active` students become `unconfirmed`, Fall 2026 CR roles end, CSE sections open, and EEE sections stay closed.
- ROL-04: if any step fails, nothing changes (the old semester is still current, students still `active`).
- ROL-05: two concurrent "make current" calls → one succeeds, one gets `ALREADY_DECIDED`.
- ROL-04(5): a draft CR is `active` with an accepted enrolment right after the rollover.
- ROL-08: a student last confirmed in 2-II gets 3-I suggested.
- ROL-09: a 3-I student calling graduate → `NOT_FINAL_TERM`.
- ROL-10: a not-enrolled student gets no day-7 reminder and isn't on the 14-day list.
- [PRD] Given an `unconfirmed` student, when they send a one-to-one message, then it is delivered (checked in spec 20). When they open My routine, then they see the update screen.

## Decisions and open questions

- **Decision:** readiness item (b) counts any published import of the department for the draft with zero errors.
- **Decision:** reminders on day 0, 7 and 14. The PRD asks for a "semester update reminder" email without saying when.

## Tasks

- [ ] Readiness computation
- [ ] Make-current transaction (+ idempotency guard, bulk state change, role switch, CR enrolments)
- [ ] Post-commit hooks (groups, caches, events, audit)
- [ ] Semester update endpoints (pre-fill, graduate, not enrolled)
- [ ] Reminder job
- [ ] Readiness UI + semester update screen
- [ ] Tests incl. the PRD rollover criterion
