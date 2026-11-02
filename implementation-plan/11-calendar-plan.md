# Plan: 11 – University Calendar

## Context

Spec 11 adds university-wide and department-specific calendar events (holidays, exams, early closings, etc.) plus single-class cancellations. This is a prerequisite for spec 12 (My routine / live status) and spec 13 (free-room view), which both need `calendar.dayRule()` and `calendar.slotRuns()`. The resolver must live in `shared/` so the client can compute live status with the exact same logic.

---

## Rules and acceptance criteria

**R1** `CAL-01` — Event fields: `scope` (`university` | dept id), `from_date`, `to_date` (YYYY-MM-DD, from ≤ to), `kind` (`holiday|prep_leave|exam|early_closing|dept_event`), optional `cutoff_min` (minutes since midnight; required for `early_closing`, optional for `dept_event`, forbidden for others), `label` 1–80 chars.

**R2** `CAL-02` — Super admin: CRUD on any event. Department admin: CRUD only on their own department's events. Cannot create `university`-scope events.

**R3** `CAL-03` — `dept_event` must have department scope. The other kinds can have either scope.

**R4** `CAL-04` — Any number of events, including overlapping ones.

**R5** `CAL-05` — Creating/editing/deleting an event is audited and emits `calendar.changed` to all affected users (all users for university scope; that department's users for department scope).

**R6** `CAL-06` — `calendar.dayRule(date, departmentId)` returns `{ kind, label?, cutoff_min? }` where kind is one of:
  - `no_semester` — date outside current semester start/end
  - `non_teaching_day` — Friday (5) or Saturday (6)
  - `closed` — any `holiday`, `prep_leave`, `exam`, or a `dept_event` without cutoff
  - `cutoff` — `early_closing` or `dept_event` with cutoff
  - `normal` — otherwise

**R7** `CAL-07` — Strictest wins: `closed` beats `cutoff`; among cutoffs, earliest cutoff wins; among `closed`, department-scope label beats university-scope, then earliest-created.

**R8** `CAL-08` — `calendar.slotRuns(slot, date)` uses the **slot's section's department** (not the requesting user's), returns `runs` (with effective `end_min`, shortened to cutoff if running at cutoff), `stopped` (with label), or `cancelled` (single-class cancellation). A class starting at or after the cutoff does not run.

**R9** `CAL-09` — Resolver is pure (no I/O), lives in `shared/calendar.js`, exported so client can use it.

**R10** `CAL-10` — Admin of a slot's owning department can cancel one published slot on one date within the current semester. `(slot_id, date)` is unique. The date must be a weekday matching the slot's `day_of_week` and not already stopped by a closed/cutoff event.

**R11** `CAL-11` — Cancellation is audited, emits `routine.changed` to the section and slot's teachers, and emails affected students and teachers (spec 15 hook).

**R12** `CAL-12` — Cancellation can be undone (deleted) by the same admins before the class's start time (`SLOT_NOT_ON_DATE` or `TOO_LATE`). Same notifications as creating.

**R13** `CAL-13` — Before saving an event that closes/cuts days with approved bookings, server returns `{ saved: false, affected_bookings: [] }` (always empty until spec 19); re-send with `confirm: true` to save.

**R14** `CAL-14` — `GET /api/calendar/upcoming` returns events in the next 14 calendar days that apply to the caller: university events plus their department's events (students/teachers), or departments of sections a teacher teaches.

**[PRD-AC1]** — Given a university `exam` event on Mon 7 Jun 2027, every student's status that day shows "Mid-term exam" and no room can be requested.

**[PRD-AC2]** — Given `early_closing` cutoff 12:00, class 11:35–12:30 shows as in class until 12:00, then "Classes over today".

**[PRD-AC3]** — Given a CSE `dept_event` (CSE FEST), CSE students see the label; EEE students see their normal status.

**[CAL-07-test1]** — Holiday + early closing on same day → `closed`.

**[CAL-07-test2]** — Two early closings at 12:00 and 13:00 → cutoff 12:00.

**[CAL-08-test1]** — Class starting at 12:00 with 12:00 cutoff doesn't run.

**[CAL-02-test1]** — Department admin creating `university` event → 403.

**[CAL-10-test1]** — Cancelling a Sunday slot on Monday date → `SLOT_NOT_ON_DATE`. Cancelling twice → `CONFLICT`.

**[CAL-06-test1]** — Date after semester end → `no_semester`.

---

## Files

### New: `shared/calendar.js`
Pure resolver: `dayRule(date, departmentId, { events, semester })` and `slotRuns(slot, date, { events, semester })`. No I/O. Exported from `shared/index.js`.

### New: `shared/schemas/calendar.js`
Zod schemas: `eventCreateBody`, `eventUpdateBody`, `eventIdParam`, `cancellationBody`, `cancellationParams`, `calendarEventsQuery`. Exported from `shared/schemas/index.js`.

### New: `server/src/modules/calendar/`
- `calendar.model.js` — `CalendarEvent` and `ClassCancellation` models + indexes
- `calendar.policy.js` — `calendar.event.manage`, `calendar.cancellation.manage`
- `calendar.service.js` — CRUD for events, cancellation create/undo, upcoming endpoint
- `calendar.controller.js`
- `calendar.routes.js`
- `index.js`
- `__tests__/calendar.api.test.js`

### Modified
- `server/src/app.js` — mount `calendarRouter`
- `shared/index.js` — export `dayRule`, `slotRuns`
- `shared/schemas/index.js` — export calendar schemas
- `shared/errors.js` — add `SLOT_NOT_ON_DATE`, `TOO_LATE`
- `server/src/modules/routine/index.js` — export `registerCancellationProvider` hook (for spec 12/13 to query cancellations)
- `shared/__tests__/shared.test.js` — unit tests for the resolver

---

## Data model

### `calendar_event`
```
scope_department_id?: ObjectId  (absent = university)
from_date: String               YYYY-MM-DD
to_date: String                 YYYY-MM-DD
kind: enum holiday|prep_leave|exam|early_closing|dept_event
cutoff_min?: Number             minutes since midnight
label: String                   1–80 chars
created_by: ObjectId
created_at: Date
```
Indexes:
- `{ from_date: 1, to_date: 1 }` — range lookups
- `{ scope_department_id: 1, from_date: 1 }` — dept filter

### `class_cancellation`
```
slot_id: ObjectId
date: String     YYYY-MM-DD
reason: String   1–500 chars
created_by: ObjectId
created_at: Date
```
Index: `{ slot_id: 1, date: 1 }` unique — enforces CAL-10 "at most one cancellation per slot per date"

No transactions needed for single-document inserts/deletes. The unique index handles the "cancel twice → CONFLICT" case at the DB level (duplicate-key error → `409 CONFLICT`).

---

## API

| Method | Path | Who | Body | Success | Errors |
|---|---|---|---|---|---|
| `GET /api/calendar-events` | admins; active users (own scope) | `?from=&to=&department_id=` | list | none |
| `POST /api/calendar-events` | per CAL-02 | event fields, `confirm?: bool` | 201 or 200 `{saved:false, affected_bookings:[]}` | `VALIDATION_ERROR`, `FORBIDDEN` |
| `PATCH /api/calendar-events/:id` | per CAL-02 | fields, `confirm?: bool` | 200 | same |
| `DELETE /api/calendar-events/:id` | per CAL-02 | none | 204 | none |
| `POST /api/slots/:id/cancellations` | admin of slot owner | `{ date, reason }` | 201 | `CONFLICT`, `SLOT_NOT_ON_DATE` |
| `DELETE /api/slots/:id/cancellations/:date` | admin of slot owner | none | 204 | `TOO_LATE` |
| `GET /api/calendar/upcoming` | active users | none | `{ data: [...] }` | none |

`can()` checks:
- `calendar.event.manage` → super admin (any dept), dept admin (own dept only, not university scope)
- `calendar.cancellation.manage` → admin of `slot.owner_department_id`

Audit actions: `calendar.event.create`, `calendar.event.update`, `calendar.event.delete`, `class.cancel`, `class.cancel.undo`.

---

## Resolver (`shared/calendar.js`)

```js
// dayRule(date, departmentId, { events, semester })
// events: array of CalendarEvent plain objects
// semester: { start_date, end_date }
// Returns: { kind, label?, cutoff_min? }

// slotRuns(slot, date, { events, cancellations, semester })
// slot: { day_of_week, start_min, end_min, section: { department_id } }
// cancellations: array of ClassCancellation plain objects for that slot
// Returns: { status: 'runs'|'stopped'|'cancelled', end_min?, label?, reason? }
```

Algorithm for `dayRule`:
1. Outside semester → `no_semester`
2. weekday(date) ∈ {5,6} → `non_teaching_day`  
3. Filter events where date ∈ [from_date, to_date] and (scope = university OR scope = departmentId)
4. If any event is `holiday|prep_leave|exam` → `closed` (label: dept over university, then earliest-created)
5. If any event is `dept_event` without cutoff → `closed`
6. If any event is `early_closing` or `dept_event` with cutoff → `cutoff` (earliest cutoff wins)
7. Otherwise → `normal`

Algorithm for `slotRuns`:
1. Check cancellations for this slot on this date → `cancelled`
2. Call `dayRule` with slot's section's departmentId
3. `closed`/`no_semester`/`non_teaching_day` → `stopped`
4. `cutoff`: if `slot.start_min >= cutoff_min` → `stopped`; else → `runs` with `end_min = min(slot.end_min, cutoff_min)`
5. `normal` → `runs` with `end_min = slot.end_min`

---

## Hooks for downstream specs

`calendar/index.js` exports:
- `registerBookingAffectedProvider(fn)` — spec 19 registers a function that returns affected bookings for a date range, used in CAL-13
- `getCancellationsForSlots(slotIds, dateRange)` — spec 12/13 use to exclude cancelled classes
- `getEventsForDepartment(departmentId, from, to)` — spec 12/13 use to apply calendar rules

---

## UI (admin only in this spec; student/teacher views are spec 12/16)

**Calendar admin page** (`client/src/routes/CalendarPage.jsx`):
- Month view (Tailwind grid, no external calendar library) or list view toggle
- Add/edit event dialog (shadcn `Dialog`): kind selector → show/hide cutoff field; date range picker (two `Input type="date"`); label input
- Affected-bookings confirmation step (empty list until spec 19, but the UX flow is wired)
- "Cancel class" entry point: added to the routine edit grid (spec 08) as a menu action on each slot

**Cancel class dialog** (`client/src/features/calendar/components/CancelClassDialog.jsx`):
- Date picker limited to the slot's weekday within the current semester
- Reason textarea

**Upcoming events card** (`client/src/features/calendar/components/UpcomingEvents.jsx`):
- Used by specs 16/17; exported from `features/calendar/index.js` so those specs can drop it in

i18n keys under `calendar.*` in `client/src/i18n/en.json`.

---

## Build order

1. **Shared resolver** (`shared/calendar.js`) + unit tests in `shared/__tests__/shared.test.js`. Run to confirm all CAL-06/07/08/09 cases pass.
2. **Shared schemas** (`shared/schemas/calendar.js`), export from `shared/schemas/index.js`.
3. **Error codes** — add `SLOT_NOT_ON_DATE`, `TOO_LATE` to `shared/errors.js`.
4. **Models** — `calendar.model.js` with indexes; `syncIndexes` picks them up automatically.
5. **Policy** — `calendar.policy.js`, register via `calendar/index.js`.
6. **Service + controller + routes** — events CRUD, cancellation create/undo, upcoming. Mount in `app.js`.
7. **API tests** (`__tests__/calendar.api.test.js`) covering all rules, cross-scope refusals, and the uniqueness constraint.
8. **Hooks exports** — `registerBookingAffectedProvider`, `getCancellationsForSlots`, `getEventsForDepartment` in `calendar/index.js`.
9. **Client** — CalendarPage, dialogs, UpcomingEvents card, i18n strings.
10. Run `run-checks` (lint + tests + build) and fix any failures.

---

## Out of scope

- Ramadan timetable (later release)
- Booking cancellation on closed days (spec 19 implements the `registerBookingAffectedProvider` hook)
- My routine and live status display (spec 12)
- Free-room view calendar integration (spec 13)
- Upcoming events card placement on dashboards (specs 16/17)
