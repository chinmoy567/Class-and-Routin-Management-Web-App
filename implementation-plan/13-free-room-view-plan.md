# Plan: Spec 13 — Free-room view (read-only)

Final saved copy (after approval): `implementation-plan/13-free-room-view-plan.md` (repo root, per CLAUDE.md and `/plan-spec`; nothing goes under `.claude/` or `.cloud/`).

## Goal
`active` students, teachers and admins pick a date (this or next week, inside the current semester) and a 5-minute time range, and see every non-retired room as Free / Busy ("In use") / Booked / Unknown. Adds `GET /api/rooms/availability`, `GET /api/rooms/free-now`, the reusable service `rooms.availability({date, from, to})`, a Free rooms page and a "Free rooms now" card component. No booking logic (spec 19).

## Checklist (rules and acceptance criteria)
1. FRV-01 query validation: `from<to`, 5-min steps, 08:00–18:00; date in current or next week (Sun–Sat, Asia/Dhaka) and inside the current semester, else `400 DATE_OUT_OF_RANGE`; bad shape → `VALIDATION_ERROR`.
2. FRV-02 availability known: owner dept AND every sharing dept have a published slot in the current semester (decision: "at least one published slot"); else `unknown`.
3. FRV-03 busy via published slot on that weekday whose `slotRuns` is `runs`, overlap uses effective end; `booked` via hook (none in R1); else `free`. Overlap = `s1<e2 && s2<e1`; touching = free.
4. FRV-03 tests: 10:30–11:25 busy for 11:00–12:00, free for 11:35–12:30, 11:25–11:35 free; cancelled slot not busy; early closing 12:00 with 11:35–12:30 class → 12:00–13:00 free.
5. FRV-04 closed day (holiday/prep/exam/dept_event) or Fri/Sat: rooms listed as `free`, `requests_allowed:false` + `day_label` (e.g. "Mid-term exam"; "No classes today" for Fri/Sat).
6. FRV-05 response rows: `id, code, type, owner{id,code}, status` only; busy/booked reveal no section/course/teacher.
7. FRV-06 filters `type`, `department_id` (owner); retired rooms never appear.
8. FRV-07 free-now: today, now rounded down to 5 min, +55 min (clamped to the 08:00–18:00 window; outside it, or today outside the semester, returns an empty-safe response).
9. FRV-08 only `active` users: others `403 STATE_NOT_ALLOWED`.
10. FRV-09 `rooms.availability()` exported from rooms module for spec 19.
11. FRV-10 p95 < 500 ms at ~150 rooms: a handful of bulk queries (no per-room queries), existing indexes; add `{semester_id, room_id, day_of_week}` index on `routine_slot` if missing.

## Blockers / open questions
- None block R1. PRD open question 2 (launch scope) only affects R2.
- Instruction wording: you said "write it in the .cloud folder". CLAUDE.md and `/plan-spec` forbid plans under `.claude/`, so I will write to `implementation-plan/` unless you say otherwise.
- Decision (override if you disagree): top-level `requests_allowed`/`day_label` use the university-wide day rule; each room row also carries its own owner-department `requests_allowed`/`day_label` so a department-only event is honoured per room.

## Files
Server (`server/src/modules/`)
- `rooms/availability.service.js` (new): `availability({date,from,to,type,department_id})`, `freeNow()`, provider registry `registerAvailabilityProvider({ busySlots, publishedDepartments, bookings })` + `resetAvailabilityProviders()` (same hook pattern as `registerRoomUsage`; avoids rooms→routine circular imports).
- `rooms/rooms.routes.js`: add `GET /availability`, `GET /free-now` (before `/`-style params); `rooms.controller.js`: two handlers; `rooms.policy.js`: `'room.availability.view'` (active only; any role); `rooms/index.js`: export `availability`, `freeNow`, `registerAvailabilityProvider`.
- `routine/index.js` (+ small `routine/availability.provider.js`): registers providers: published slots for a semester/weekday/range joined with calendar events and cancellations (`getEventsForDepartment`, `getCancellationsForSlots` from calendar index) → apply shared `slotRuns`; `publishedDepartments(semesterId)` = distinct `owner_department_id` of published slots.
- `lib/time.js`: small helpers only if missing (current/next week bounds via existing `weekStart`, `addDays`).
Shared (`shared/`)
- `schemas/rooms.js`: `availabilityQuery` (Zod: date `YYYY-MM-DD`, `from`/`to` as `HH:mm` or minutes on 5-min steps within 480–1080, `from<to`, `type?`, `department_id?`); `errors.js`: add `DATE_OUT_OF_RANGE` (400); pure `rangesOverlap` helper (+ unit test).
Client (`client/src/`)
- `features/rooms/api.js` + `hooks.js`: `fetchAvailability`, `fetchFreeNow`, query keys; refetch on `booking.changed`/`routine.changed`/`calendar.changed`.
- `routes/FreeRoomsPage.jsx` (new) + route/nav entry in `App.jsx`; `features/rooms/components/FreeRoomsNowCard.jsx`, `RoomStatusGroup.jsx`; strings in `i18n/en.json`.

## Data model
No new collections. Reads `room`, `room_share`, `routine_slot`, `calendar_event`, `class_cancellation`, current `semester`. Possible index on `routine_slot: {semester_id:1, day_of_week:1, room_id:1}` (declared in the Mongoose schema) if not already covered.

## API
- `GET /api/rooms/availability?date&from&to&type?&department_id?` → `{data:{date,from,to,requests_allowed,day_label?,rooms:[{id,code,type,owner:{id,code},status,requests_allowed,day_label?}]}}`; errors `DATE_OUT_OF_RANGE`, `VALIDATION_ERROR`, `STATE_NOT_ALLOWED`.
- `GET /api/rooms/free-now` same shape, no query.
- `can(user,'room.availability.view')` in the service (state `active`; role-agnostic). No writes, so no audit entries. Zod on query via existing `validate`.

## UI
Free rooms page: date picker (only this and next week enabled), 5-min from/to pickers, type filter, results grouped Free / Unknown / In use / Booked with legend; every status has a text label (not colour only); mobile ≥360px; account-state screens already handled by route guards. "Free rooms now" card component for the later dashboards (spec 16).

## Tests (Vitest + Supertest, in `rooms/__tests__/availability.api.test.js`, plus shared unit test)
Names carry FRV ids. Cover checklist 1–11: touching/overlap, cancelled, early-closing, exam day label, unknown when a sharing dept has no published slot, three-weeks-ahead → `DATE_OUT_OF_RANGE`, `claim_pending` → 403, no section/course/teacher keys on busy rows, retired excluded, filters, free-now rounding (clock fixed via `clock.set`), booking-provider hook marks `booked`, 5-min/range/window validation, Fri/Sat. Cross-scope: student/teacher/dept admin of another department see only the sanitized shape and cannot learn routine details. Perf smoke: seed ~150 rooms, assert a bounded number of queries (not wall-clock). Client: component test for grouping/labels.

## Build order
1. Shared schema, error code, overlap helper + unit tests.
2. Rooms availability service + provider registry + policy; routine provider; service tests.
3. Routes/controller; API tests (permissions, validation, filters).
4. free-now; tests.
5. Client api/hooks, page, card, i18n; component tests.
6. Run `run-checks` (lint, tests, build); then `/verify-spec 13` to write the report under `test-results/`.

## Out of scope
Room requests, booking locks, the request button, dashboards themselves (spec 16), Ramadan timetable, any socket events beyond consuming existing ones.

## Verification
`npm test -w @crm/server`, `npm test -w @crm/client`, `npm run lint`, `npm run build`, then `/verify-spec 13`. Manual: run both dev servers, sign in as an active student, open Free rooms, check each status label. Node must be 24.22.2 (24.15.0 crashes vitest workers).

## Departures from this plan (made while building)
- **Time parameters are minutes since midnight** (`from=660`), not `HH:mm`, to match the conventions (times of day are minutes). The client shows `HH:MM`.
- **Overlap helper** lives in `shared/availability.js` (`rangesOverlap`) so client and server share it.
- **State check first:** `assertState` throws `STATE_NOT_ALLOWED` before `assertCan`, because `assertCan` alone returns a generic `FORBIDDEN`. The policy entry `room.availability.view` also checks `active`.
- **Provider names:** `registerAvailabilityProvider({ publishedDepartments, runningSlots, dayRules, bookedRoomIds })`. The routine module registers the first three (`server/src/modules/routine/availability.provider.js`); `bookedRoomIds` is left for spec 19.
- **Free now outside 08:00–18:00** returns `rooms: []` (no clamping to the window), and `to` is capped at 18:00.
- **Pickers** are native `<input type="date">` and `<select>` elements (5-minute steps), because no date-picker library is in `tech-stack.md`.
- **Dashboard card:** `FreeRoomsNowCard` is built and tested but not placed on any dashboard; dashboards are spec 16.
- **Shared error code:** `DATE_OUT_OF_RANGE` added to `shared/errors.js`, to the FND-11 code list in `server/src/__tests__/app.test.js`, and to `client/src/i18n/en.json`.
