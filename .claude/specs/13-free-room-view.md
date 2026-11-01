# 13: Free-room view

R1 · Status: Draft · Depends on: 05, 07, 11 · PRD: Core features (F8), Classroom booking rules (Availability must be known, Booked rooms, Overlap), Semesters and student updates (free rooms paragraph), Acceptance criteria (Booking: availability unknown) · Diagrams: 28-activity-free-room-check

## Goal

Anyone `active` picks a date (this week or next) and a time range and sees which rooms are free then. A room whose availability isn't known (because a department that uses it hasn't published a routine) is shown as "Availability unknown". R1 is read-only. Requesting a room comes in R2 (spec 19).

## Scope

**In:** the availability query, the "availability known" rule, free/busy/booked/unknown per room, the screen with date and time pickers, "free rooms now".

**Out:** the request button and booking logic (spec 19).

## Requirements

- **FRV-01** The query takes a date and a time range (`from`, `to`, on 5-minute boundaries, `from < to`, between 08:00 and 18:00). The date must be in the current or next week (Sunday to Saturday, institution time) and inside the current semester. Otherwise `400 DATE_OUT_OF_RANGE`.
- **FRV-02** A room is **availability known** when its owning department **and** every sharing department have published slots in the current semester (`routine_import` published, or at least one published slot). Otherwise it is `unknown` and is listed but can't be requested.
- **FRV-03** For a known room, its status in the range is:
  - `busy` if a published slot that **runs** on that date (spec 11 `slotRuns`: not stopped by an event, not cancelled) overlaps the range, using the slot's effective end,
  - `booked` if an approved booking overlaps (spec 19; none in R1),
  - otherwise `free`.
  Overlap means `start₁ < end₂ && start₂ < end₁`. Ranges that only touch don't overlap.
- **FRV-04** On a day where the day rule (for the room's owning department) is `closed`, rooms are listed as `free` for viewing, but the response carries `requests_allowed: false` with the label. The same applies on Friday and Saturday.
- **FRV-05** Each room in the response shows code, type, owner department code and status. For `busy` it shows only "In use" (not which class). For `booked` it shows only "Booked", never which section or teacher.
- **FRV-06** Rooms can be filtered by type (classroom/lab) and owner department. Retired rooms never appear.
- **FRV-07** "Free rooms now": the same query for today, from now (rounded down to 5 minutes) to +55 minutes, used by dashboards.
- **FRV-08** `active` students, `active` teachers, and admins can use the view. Other states → `403 STATE_NOT_ALLOWED`.
- **FRV-09** The availability computation is a service function `rooms.availability({ date, from, to })`, reused by booking (spec 19) for the "room free" check.
- **FRV-10** The query responds within 500 ms at the 95th percentile with ~150 rooms (indexed by `semester_id, room_id, day_of_week`).

## Permissions

| Action | Who |
|---|---|
| View free rooms | `active` students and teachers; admins |

## Data

No new collections. Uses `room`, `room_share`, `routine_slot`, `class_cancellation`, `calendar_event`, and later `room_request` / `room_slot_lock`.

## API

| Method and path | Who | Query | Success | Errors |
|---|---|---|---|---|
| `GET /api/rooms/availability` | see above | date, from, to, type?, department_id? | `{ date, from, to, requests_allowed, day_label?, rooms: [{ id, code, type, owner, status }] }` | `DATE_OUT_OF_RANGE`, `VALIDATION_ERROR`, `STATE_NOT_ALLOWED` |
| `GET /api/rooms/free-now` | same | none | same shape | same |

## Screens

Free rooms page: date picker (only this week and next week enabled), from/to time pickers (5-minute steps), type filter, results grouped Free / Unknown / In use / Booked, with a legend. Each status has a text label, not only a colour. A "Free rooms now" card goes on the dashboards.

## Acceptance tests

- FRV-02: [PRD] given a room shared with EEE while EEE has not published its routine for the current semester, then the room shows "Availability unknown" and cannot be requested (the "cannot be requested" part is checked in spec 19).
- FRV-03: room 311 used 10:30–11:25 is `busy` for 11:00–12:00 and `free` for 11:35–12:30. A range 11:25–11:35 is `free` (touching only).
- FRV-03: a slot cancelled for that date doesn't make the room busy.
- FRV-03: on an early-closing day with cutoff 12:00, a 11:35–12:30 class makes the room busy only until 12:00, so 12:00–13:00 is `free`.
- FRV-01: a date three weeks ahead → `DATE_OUT_OF_RANGE`.
- FRV-04: [PRD] on a university exam day, the response has `requests_allowed: false` with "Mid-term exam".
- FRV-05: the response for a busy room has no section, course or teacher fields.
- FRV-08: a `claim_pending` student → `403`.

## Decisions and open questions

- **Decision:** "published routine" for availability means the department has at least one published slot in the current semester.
- **Decision:** on closed days rooms still show as free for viewing (FRV-04). Only requests are blocked.

## Tasks

- [ ] `rooms.availability()` service (known check, busy via `slotRuns`, booked hook)
- [ ] Endpoints + validation (window, semester, 5-minute steps)
- [ ] Free rooms page + "free now" card component
- [ ] Tests incl. touching ranges, cancellations, early closing
