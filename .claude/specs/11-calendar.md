# 11: University calendar

R1 · Status: Draft · Depends on: 04, 07 · PRD: University calendar, Live class status (step 5), Admin dashboard and controls (Cancel a single class, Calendar events), Acceptance criteria (Calendar and live status) · Diagrams: 14-activity-live-status, 25-routine-resolution

## Goal

Super admins keep university-wide calendar events, and department admins keep their own department's events. Department admins can also cancel a single class on one date. One shared rule function tells live status, the free-room view and booking whether a slot really runs on a date.

## Scope

**In:** calendar event CRUD, the event kinds and their effects, overlap resolution (strictest wins), single-class cancellation, the "does this slot run on this date" resolver, upcoming events for dashboards.

**Out:** the Ramadan timetable (later release), cancelling bookings on closed days (spec 19 implements the hook defined here).

## Requirements

### Events
- **CAL-01** An event has scope (`university` or one department), from date, to date (inclusive, from ≤ to), kind (`holiday` | `prep_leave` | `exam` | `early_closing` | `dept_event`), optional cutoff time (required for `early_closing`, optional for `dept_event`, not allowed for the others), and a label (1–80 characters).
- **CAL-02** A super admin can create, edit and delete events of any scope. A department admin can do so only for their own department's scope, and can't create `university` events.
- **CAL-03** `dept_event` must have department scope. The other kinds can have either scope.
- **CAL-04** Any number of events can exist, and they can overlap.
- **CAL-05** Creating, editing or deleting an event is audited and sends `calendar.changed` to everyone affected (all users for university scope, the department for department scope).

### Effects (the resolver)
- **CAL-06** `calendar.dayRule(date, departmentId)` returns `{ kind: 'normal' | 'closed' | 'cutoff' | 'no_semester' | 'non_teaching_day', label?, cutoff_min? }` for the students and slots of that department on that date:
  - outside the current semester's start and end dates → `no_semester` ("No classes"),
  - Friday or Saturday → `non_teaching_day` ("No classes today"),
  - a `holiday`, `prep_leave` or `exam` event (university, or this department), or a `dept_event` of this department without a cutoff → `closed` with the label,
  - an `early_closing` (university, or this department), or a `dept_event` of this department with a cutoff → `cutoff` with the label and cutoff time,
  - otherwise `normal`.
- **CAL-07** When several events apply, the strictest wins: `closed` beats `cutoff`, and among cutoffs the earliest cutoff wins. Among `closed` events, the label of the most specific one wins (department over university), then the earliest-created.
- **CAL-08** `calendar.slotRuns(slot, date)` applies the day rule of the **slot's section's department** and returns: `runs` (with its effective end, which is shortened to the cutoff if the class is running at the cutoff), `stopped` (with the label), or `cancelled` (single-class cancellation, with the reason). A class that **starts** at or after the cutoff doesn't run. A class running at the cutoff ends at the cutoff.
- **CAL-09** The resolver is pure (data in, answer out) and lives in `shared/` so the client's live status uses exactly the same rules.

### Single-class cancellation
- **CAL-10** The admin of the slot's owning department can cancel one published slot on one date within the current semester, with a reason. `(slot_id, date)` is unique. The date must be a date the slot would normally run (its weekday and not already stopped).
- **CAL-11** Cancelling is audited, sends `routine.changed` to the section and the slot's teachers, and emails the affected students and teachers (spec 15). The room is free in that slot on that date (spec 13).
- **CAL-12** A cancellation can be undone (deleted) by the same admins before the class's start time, with the same notifications.

### Bookings (hook for R2)
- **CAL-13** Before saving an event that closes or cuts short days, the server returns the list of approved bookings it would affect (`200 { saved: false, affected_bookings }`), and the admin re-sends with `confirm: true`. On save, bookings on fully closed days, or past the new cutoff, are cancelled and their requesters emailed (spec 19). Until spec 19 exists the list is always empty.

### Upcoming events
- **CAL-14** `GET /api/calendar/upcoming` returns the events of the next 14 days that apply to the caller (university plus their department, or the departments of the sections a teacher teaches).

## Permissions

| Action | Super admin | Dept admin | Others |
|---|---|---|---|
| University events | ✔ | ✘ | ✘ |
| Department events | ✔ (any dept) | own dept | ✘ |
| Cancel / un-cancel a class | ✔ | slots their dept owns | ✘ |
| Read events | ✔ | ✔ | signed-in `active` users (their scope) |

## Data

- `calendar_event`: scope_department_id? (empty = university), from_date, to_date, kind, cutoff_min?, label, created_by, created_at. Index `{ from_date: 1, to_date: 1 }`, `{ scope_department_id: 1, from_date: 1 }`.
- `class_cancellation`: slot_id, date, reason, created_by, created_at. Unique `{ slot_id, date }`.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/calendar-events?from=&to=&department_id=` | admins; users (own scope) | none | list | none |
| `POST /api/calendar-events` | per CAL-02 | event fields, confirm? | 201, or 200 `{ saved: false, affected_bookings }` | `VALIDATION_ERROR`, `FORBIDDEN` |
| `PATCH /api/calendar-events/:id` | per CAL-02 | fields, confirm? | 200 | same |
| `DELETE /api/calendar-events/:id` | per CAL-02 | none | 204 | none |
| `POST /api/slots/:id/cancellations` | admin of slot owner | date, reason | 201 | `CONFLICT` (already cancelled), `SLOT_NOT_ON_DATE` |
| `DELETE /api/slots/:id/cancellations/:date` | admin of slot owner | none | 204 | `TOO_LATE` |
| `GET /api/calendar/upcoming` | `active` users | none | events in the next 14 days | none |

## Screens

Calendar page (admin): month view or list, add/edit dialog with kind-specific fields, affected-bookings confirmation. "Cancel class" action on a slot in the routine edit grid (spec 08), with a date picker limited to the slot's weekdays. Upcoming events card (specs 16, 17).

## Acceptance tests

- [PRD] Given a university `exam` event on Mon 7 Jun 2027, then every student's status that day shows "Mid-term exam" and no room can be requested.
- [PRD] Given an `early_closing` event with cutoff 12:00, then a class from 11:35 to 12:30 shows as in class until 12:00, then "Classes over today".
- [PRD] Given a CSE `dept_event` (CSE FEST), then CSE students see the label while EEE students see their normal status.
- CAL-07: a holiday and an early closing on the same day → `closed`. Two early closings at 12:00 and 13:00 → cutoff 12:00.
- CAL-08: a class starting at 12:00 with a 12:00 cutoff doesn't run.
- CAL-02: a department admin creating a university event → `403`.
- CAL-10: cancelling a Sunday slot on a Monday date → `SLOT_NOT_ON_DATE`. Cancelling twice → `CONFLICT`.
- CAL-06: a date after the semester end → `no_semester`.

## Decisions and open questions

- **Decision:** a `dept_event` applies by the **section's** department (CAL-08). A CSE-owned slot for LAW students is stopped by a LAW event, not a CSE event, because the PRD says it affects "one department's students".
- **Decision:** among overlapping cutoffs, the earliest wins (the strictest).

## Tasks

- [ ] `calendar_event`, `class_cancellation` models + indexes
- [ ] Pure resolver in `shared/` (`dayRule`, `slotRuns`) with thorough unit tests
- [ ] Event CRUD with scope checks, affected-bookings hook, events, audit
- [ ] Cancellation create/undo with notifications
- [ ] Upcoming endpoint
- [ ] Calendar admin page, cancel-class dialog
- [ ] Tests
