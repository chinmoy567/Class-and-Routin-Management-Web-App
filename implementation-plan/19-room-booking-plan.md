# Plan: Spec 19 — Room booking (R2)

## Context
"Pack 19" = `.claude/specs/19-room-booking.md` (status Draft). CR/DCR and linked teachers request a free room for a dated range; a department admin approves one request; the DB guarantees no double-booking. Groundwork already exists: `rooms/availability.service.js` has an empty `bookedRoomIds` provider slot, `routine/bookings.hooks.js` (EDT-05) has registrars with nothing registered, `calendar.service.js` has `registerBookingAffectedProvider`, email templates `room_request_result|booking_cancelled|request_expired` exist, feature flags `admin.room_requests`, `cr.room_requests`, `dashboard.teacher.room_requests` are `'R2'`, `BookingClashDialog` is on the client. Nothing else (no models, routes, jobs, UI). Deps 13 and 18 have working code (spec statuses are stale). PRD Open question 2 (which departments go live together) affects launch, not code: unpublished sharing departments already yield "Availability unknown".

This plan will be saved to `implementation-plan/19-room-booking-plan.md` after approval, then implemented in the order below. No commits unless asked.

## Rules checklist (every item gets a test named `BKG-nn …`)
BKG-01..03 who/what/sent_by · 04..11 send checks (ROOM_NOT_FREE, AVAILABILITY_UNKNOWN, TARGET_BUSY, TEACHER_BUSY, NOT_TEACHING_DAY, TOO_LATE, OUTSIDE_WINDOW, REQUEST_LIMIT) · 12..16 queue/approve/reject/cutoff/emails · 17 expiry job · 18..20 effects (routine, My routine, live status, free rooms, `booking.changed`) · 21..23 cancel, late_cancel, decider cancel, no-show · 24 routine edit/import hook · 25 calendar hook · 26 dashboards. Plus the 8 PRD acceptance tests, the concurrency tests (4 simultaneous overlapping requests → 3 pending; two admins approve → one 409 `ALREADY_DECIDED`; touching ranges both approve), plain student → 403, and cross-scope refusals (CR of another section, teacher not teaching the section, admin of an unrelated department, admin deciding outside their room's departments).

## Server — new module `server/src/modules/bookings/`
(Spec lists the modules; a new folder `bookings` keeps room-request logic out of `rooms`/`routine`. Other modules are touched only via their exported functions or registered hooks.)
- `bookings.model.js`: `RoomRequest` (fields per spec; indexes as listed) and `RoomSlotLock` (unique `{room_id,date,block_start}`, 5-minute blocks).
- `checks.js`: pure/near-pure functions for BKG-04..10 (use `shared/availability.rangesOverlap`, `shared/calendar.dayRule`, `lib/time.instantFrom/weekStart`, `rooms.availability()` for room free/unknown, section/teacher busy from routine's slots loader + approved bookings). Reused by send and approve (approve skips the 12-hour rule).
- `send.service.js`: one `withTransaction`: run checks, `$inc` `request_seq` on the requester doc (section or teacher) to serialize, count overlapping pending (BKG-11), insert, audit (`room_request.create`), `afterCommit` emit.
- `decision.service.js`: approve = conditional `findOneAndUpdate({_id,status:'pending'})`, re-run checks, insert locks in 5-min blocks (E11000 → `ALREADY_DECIDED`), cancel requester's overlapping pending (`another_request_approved`), reject others overlapping same room (`room_given_to_another`), audit, emails, events; all in one transaction. Reject = conditional update. Cutoff `DECISION_CUTOFF_PASSED` at start − 2 h.
- `cancel.service.js` (requester/section CR-DCR or decider; approved → delete locks same transaction; `late_cancel` < 6 h; reason required for decider), `noshow.service.js` (`TOO_EARLY` before slot end).
- `bookings.jobs.js`: `booking.expire` every 5 min, idempotent conditional `updateMany`; schedule it in `server.js` beside the existing recurring jobs; add `defineBookingJobs` to the registrars.
- `bookings.policy.js` (`room_request.create|cancel|decide|view_queue|no_show`, state + role + scope; sections taught computed server-side from the routine, never from the request), `bookings.routes.js`/`controller` (endpoints exactly as in the spec; mount `app.use('/api', roomRequestRouter)`), `queue.service.js` (grouped by room/slot, oldest first, with requester's other requests), `hooks.js` + `index.js` (registers providers below).
- Per-requester counters: add `request_seq` to `Section` (`routine`) and `Teacher` (`teachers`) with exported bump helpers (mirror `bumpSectionRoleSeq`).

## Server — touching existing modules (via hooks, no cross-collection reads)
- `rooms`: register `bookedRoomIds` from bookings index (approved only).
- `routine`: replace the three hard-coded `bookings: []` in `my-routine.service.js` with a new `registerBookingsProvider`; make `shared/liveStatus.js` treat bookings as running slots (BKG-18, incl. teacher routine/status); register EDT-05 clash provider + action handler (cancel_booking → decider cancel path); **add the missing IMP-19 hook in `import.service.js`** reusing `findBookingClashes`/`applyBookingAction`.
- `calendar`: register the affected-bookings provider (preview) **and add a post-save hook so `confirm:true` actually cancels approved bookings + expires pending ones and emails** (BKG-25; today it only returns a preview).
- `notifications`: extend the three templates with outcome/reason data and update the snapshot test; digest provider `registerDigestProvider` for pending requests by cutoff.
- `admin/dashboard.service.js` and `representatives/cr/cr.overview.service.js`: add `room_requests` data when released; teacher dashboard card data in `dashboard/`.
- `shared/`: error codes `ROOM_NOT_FREE, AVAILABILITY_UNKNOWN, TARGET_BUSY, TEACHER_BUSY, NOT_TEACHING_DAY, OUTSIDE_WINDOW, REQUEST_LIMIT, DECISION_CUTOFF_PASSED, TOO_EARLY` (409; `REQUEST_LIMIT` 409, not 429 which is `FLAG_LIMIT`), `schemas/roomRequests.js` (exported from both indexes), booking status enum.
- Socket: verify which rooms sockets join in `lib/socket.js`; add section/teacher rooms if `booking.changed` cannot otherwise reach affected users (payload = ids only).

## Client
- `features/room-requests/` (`api.js`, `hooks.js`, request dialog with RHF + Zod from `@crm/shared`, modelled on `CancelClassDialog`/`SlotDialog`; `MyRoomRequestsCard`; admin queue page `/admin/room-requests` under `RequireAdmin`; cancel/no-show actions). Add `qk.myRoomRequests`, `qk.adminRoomRequests`.
- `RoomStatusGroups` gets a Request button for `free` rows via an `onRequest` prop from `FreeRoomsFinder`, passed only for CR/DCR (own section) and linked teachers (sections taught); students see none.
- Cards: `RoomRequestsCard` in `AdminDashboardPage` (placeholder at line ~190, ADM-06), "My room requests" on `CrDashboardPage` and the teacher branch of `DashboardPage`.
- `booking.changed` also invalidates the request keys; `409 ALREADY_DECIDED` refetches and shows "Already decided".
- i18n: add all new codes/strings to `client/src/i18n/en.json` and the server `en.json`; fix `errors.TOO_LATE` wording (currently about class start) with a booking-specific key.

## Build order (tests written with each step)
1. shared codes/schemas/enums → 2. models + indexes → 3. checks + send (limit, concurrency) → 4. decisions + locks → 5. cancel/no-show/expiry job → 6. provider wiring (rooms, routine/my-routine/liveStatus) → 7. EDT-05/IMP-19/CAL-13 hooks → 8. emails/events/audit/digest → 9. dashboards data → 10. client → 11. `run-checks` (lint, test, build) and walk the checklist.

## Decisions I'll take (override if you disagree)
- New `bookings` module folder (not inside `rooms`).
- Leave `CURRENT_RELEASE` at `'R1'`: the flagged cards/endpoints stay hidden until you bump it; tests set the release explicitly. Say so if you want R2 switched on now.
- Update spec 19 status to In progress and tick its tasks as they land; record the IMP-19 and CAL-13 gaps as spec edits first.
- No new libraries.

## Verification
`npm test -w @crm/server`, `npm test -w @crm/client`, `npm run lint`, `npm run build`; the Node 24.22.2 note applies (24.15.0 kills vitest workers). Optionally run both dev servers and exercise request → approve → cancel in the browser.

## Out of scope
Booking penalties beyond the no-show note, chat, announcements, bumping the release flag.

## Departures from the approved plan (recorded after building)

- Endpoints are not hidden by the release flag. Only the cards and buttons are gated (plan said both).
- The request form omits the optional group and named-teacher inputs (server supports both). Open.
- BKG-16 student and teacher emails are not built. Open.
- Teachers and CR/DCRs are still emailed by requester only (`sent_by_user_id`).
- Added `starts_at` and the index `{ status, starts_at }` for the expiry job (the plan's `{ status, date, start_min }` cannot answer "starts within 2 hours" in one query).

