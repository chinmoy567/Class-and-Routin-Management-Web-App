# Plan: Spec 16 — Student and teacher dashboards

## Context

Spec 16 (`.claude/specs/16-student-teacher-dashboards.md`, R1, depends on 12 and 13, both built) gives an `active` student or teacher a home page: status and countdown, today's classes, week grid, notices, free rooms, their section (students) or section rosters (teachers), and profile reminders. Today `client/src/routes/HomePage.jsx` is a "Welcome" placeholder and there is no `/api/me/dashboard`, no roster endpoint and no `shared/features.js`.

What already exists and is reused (not rebuilt):
- `GET /api/me/routine` + `shared/liveStatus.js` + `useMyRoutine / useLiveStatus / useRoutineSocket` (spec 12). The live-status card, week grid and day list currently live inline in `client/src/routes/MyRoutinePage.jsx`.
- `rooms.freeNow(actor)` (spec 13) and `FreeRoomsNowCard` (`client/src/features/rooms/components/`).
- `calendar.upcomingEvents(actor)` (next 14 days, `calendar.event.read` for `active`).
- `teachers.sectionsTaughtBy(userId)` (TCH-16), `teachers.recordsOf`, `representatives.crDcrOf`, `auth.studentSummaries`, `enrolments.acceptedEnrolmentOf`, `routine.getSectionBrief / getGroupBrief`, `organisation.currentSemester / departmentNames`.

No open question in the PRD blocks this spec (they concern email, launch scope, blocked periods, hosting, teachers in two departments). Spec 17 (CR/DCR dashboard) and 19/20 (booking, chat) are not built, so their cards stay hidden.

## Rules and acceptance checklist

R1 DSH-01 `GET /api/me/dashboard` returns every card's data in one call; routine loaded in parallel from `/api/me/routine`; dashboard main content < 2 s p95 on 4G.
R2 DSH-02 Release flag map in `shared/features.js` (`R1`,`R2`,`R3`,`LATER`). Card for an unreleased feature is not rendered and its data is not requested.
R3 DSH-03 One column on phones in order: status/countdown, today's classes, notices, rooms, section (student) / students (teacher), profile reminders. Empty card = hidden or short empty message, never a blank box.
R4 DSH-04 Status and countdown refresh on their own (RTN-12 hooks), no reload.
R5 DSH-05 Student right-now: live status, countdown, current/next class card (course, full teacher name for the student's group, room, time).
R6 DSH-06 Student routine: today's classes (current marked), week grid Sun–Thu (today highlighted, day list on phones), tomorrow preview (first class tomorrow + start time).
R7 DSH-07 Student notices: calendar events next 14 days. Messages/announcements/notifications hidden.
R8 DSH-08 Student rooms: "free rooms now", view only.
R9 DSH-09 My section: CR + DCRs (name, photo), courses with the full teacher name **for the student's group**, link to CR/DCR dashboard if the student holds the role.
R10 DSH-10 Profile reminders: level/term/section/group read-only, semester badge ("Fall 2026 confirmed"), email banner if email bouncing/unverified, group notice if no group.
R11 DSH-11 Teacher right-now: "Teaching"/"Free", countdown, current/next class (course, section, group, room, time); shared lab shows both teachers' full names.
R12 DSH-12 Teacher routine: today across sections, week grid cells with course/section/group/room, next-teaching-day preview when no classes remain today.
R13 DSH-13 Teacher students: roster per taught section (name, UV ID, group). Section not taught → `404`. No phone/email keys.
R14 DSH-14 Teacher rooms: free rooms with date/time picker (spec 13). Request button / "My room requests" arrive in R2 (hidden).
R15 DSH-15 Teacher notices: calendar events next 14 days. Messages/notifications/announcements hidden.
R16 DSH-16 Teacher account: linked short code + name, or "not linked yet" notice (empty routine); reminders when phone/photo (and email) missing.
R17 Permissions: dashboard = `active` students/teachers, other states → `403 STATE_NOT_ALLOWED`; roster = teacher who teaches the section, admin of the section's department; everyone else `404`. Through `can()`; "sections taught" from the routine on the server only.
R18 PRD privacy: no email/phone of other users anywhere in these responses; account state table respected.
R19 Acceptance tests (spec): DSH-02, DSH-09, DSH-10, DSH-13, DSH-16, DSH-01 (Playwright, 360 px, throttled 4G).

## Blockers / open questions

None blocking. Decisions I made (tell me if you want any changed):
1. **CR/DCR roster access** is *not* added now. The spec's permission table lists it "(spec 17)", so the roster policy covers teachers + department/super admins; spec 17 extends it and adds `confirmed_this_semester`.
2. **Teacher "date and time picker" (DSH-14)**: the teacher Rooms card shows free-now plus a "Pick a date and time" link to the existing `/rooms/free` page (which already has the pickers). It does not duplicate the picker on the dashboard.
3. **CR/DCR dashboard link (DSH-09)**: shown when the student holds a CR/DCR role. Its target route is built in spec 17, so until then it lands on the not-found page.
4. **Release gating**: `CURRENT_RELEASE = 'R1'` in `shared/features.js` plus `isReleased(feature, release = CURRENT_RELEASE)`. Later specs plug card data in through a small provider registry (`registerDashboardCard`), so an unreleased card's provider is never called. Tests pass an explicit release to prove R1 vs R3.
5. **Routine window on the dashboard**: request 7 days (same query key as My routine, so both pages share one cached fetch). Today's date for the request window is formatted in `Asia/Dhaka` from the device clock; every status and countdown still uses server `server_time`. This also fixes `MyRoutinePage`'s `toISOString()` (UTC) date helper that I'll replace with the shared one.
6. **Existing bug to fix in passing** (needed by the status card): `MyRoutinePage`'s `LiveStatusCard` reads `next.course_code`/`next.start_min`, but `liveStatus` returns `next = { slot, date }`. The extracted `StatusCard` reads `next.slot`.
7. **Semester-overdue warning** (PRD, badge): an `active` student is always confirmed for the current semester (unconfirmed students are routed to the update screen), so the badge only needs a defensive "not confirmed" warning.

## Files

**shared/**
- `shared/features.js` (new): release map, `CURRENT_RELEASE`, `isReleased`. Export from `shared/index.js`.
- `shared/schemas/dashboard.js` (new): `sectionIdParam` for the roster route; export from `shared/schemas/index.js`.
- `shared/__tests__/features.test.js` (new).

**server/src/modules/dashboard/** (new module)
- `index.js` — registers policies; exports `dashboardMeRouter`, `sectionRosterRouter`, `registerDashboardCard`, `resetDashboardCards`.
- `dashboard.routes.js`, `dashboard.controller.js`, `dashboard.policy.js`.
- `dashboard.service.js` — `getDashboard(actor, { release })`: state check, then `Promise.all` of the card builders.
- `student.card.js`, `teacher.card.js` — build the student / teacher parts.
- `reminders.js` — email/phone/photo/group/semester facts, booleans only.
- `cards.js` — provider registry gated by `isReleased`.
- `roster.service.js` — `getSectionRoster(actor, sectionId)`.
- `__tests__/dashboard.api.test.js`, `roster.api.test.js`, `cards.test.js`.

**Existing server modules — small exported helpers only (each module's `index.js`)**
- `routine/my-routine.service.js` + `routine/index.js`: export `sectionCourses({ semesterId, sectionId, groupId })` over the cached `sectionSlotPattern` (distinct courses, teachers of slots the student's group sees).
- `enrolments/enrolment.service.js` + `index.js`: `listAcceptedOfSection(sectionId, semesterId)`, `countAcceptedBySection(sectionIds, semesterId)`, `approvedUvIds(userIds)`.
- `auth/` + `auth/index.js`: `contactStatus(userId)` → `{ email_verified, email_bouncing, has_phone, has_photo }` (selects `phone_enc` only to test presence; never returns it).
- `server/src/app.js`: mount the two routers (one line each; the file already has uncommitted spec-15 edits, which I will not touch).

**client/**
- `client/src/features/dashboard/api.js`, `hooks.js` (`useDashboard`, `useSectionRoster`, socket refresh), `utils.js` (tomorrow / next-teaching-day helpers).
- `client/src/features/dashboard/components/`: `StatusCard`, `TodayList`, `UpcomingEvents`, `SectionCard`, `RosterCard`, `ReminderBanner`, `TeacherAccountCard`, `RoomsCard` (wraps `FreeRoomsNowCard`).
- `client/src/features/routine/components/WeekGrid.jsx` and `DayList.jsx` (moved out of `MyRoutinePage`, grid cell shows all slots in a period, plus section/group for teachers); `MyRoutinePage` imports them (behaviour unchanged, existing test must still pass).
- `client/src/features/rooms/components/FreeRoomsNowCard.jsx`: accept `data` prop (dashboard supplies it, no second request) and use `free_count`.
- `client/src/routes/HomePage.jsx` becomes a dispatcher by `me.kind`; `StudentDashboardPage.jsx`, `TeacherDashboardPage.jsx` (new). Staff-only accounts keep the current placeholder until spec 18.
- `client/src/lib/query-keys.js` (add `dashboard`, `sectionRoster`), `client/src/i18n/en.json` (`dashboard.*`).
- Tests: `features/dashboard/__tests__/*.test.jsx`, `client/e2e/dashboard.spec.js`.

## Data model

No new collections, no schema changes. Reads only: `enrolment` (accepted, current semester; uses the existing `section_id, status` index), `uv_claim` (approved, by `user_id` — existing `user_id, status` index), `user`, `teacher`, `routine_slot*` (through cached routine helpers), `calendar_event`, rooms (through `freeNow`). No transactions, no "first action wins" update: the endpoints are read-only, so no audit entries (the PRD's Auditability list does not cover dashboard or roster reads).

## API

| Endpoint | Zod | `can()` / state | Result |
|---|---|---|---|
| `GET /api/me/dashboard` | none (no input) | state must be `active` else `403 STATE_NOT_ALLOWED`; then `can(user,'dashboard.read')` (student or teacher kind, else `403 FORBIDDEN`) | `{ kind, section?, representatives?, courses?, upcoming_events, free_now, reminders, teacher_link?, sections_taught? }` plus keys from released card providers |
| `GET /api/sections/:id/roster` | `sectionIdParam` (24-hex) | state `active` else `403 STATE_NOT_ALLOWED`; load section brief + `sectionsTaughtBy(user)` on the server, then `can(user,'section.roster.read', { section_id, department_id, taught })` with `hideExistence` → `404 NOT_FOUND` for any refusal | `[{ user_id, name, photo, uv_id, group }]` — current-semester accepted students in `active` state, sorted by name |

Response details: `section` = `{ id, name, level, term, letter, group, my_role }`; `representatives` = `[{ user_id, role, name, photo }]`; `courses` = `[{ course_code, course_name, teachers:[{short_code, full_name}] }]`; `free_now` = trimmed free-now (`free_count` + up to 20 free rooms); `reminders` = booleans/labels (`email: ok|unverified|bouncing`, `group_missing`, `semester_badge`, `phone_missing`, `photo_missing`); `teacher_link` = `{ linked, records:[{short_code, full_name}] }`; `sections_taught` = `[{ section_id, name, student_count }]`. Rosters are loaded on demand (one section at a time), not in the summary. No audit entries.

## UI

- Student page, in order: `StatusCard` → `TodayList` (+ tomorrow preview) → `WeekGrid` (md and up) / `DayList` (phones) → `UpcomingEvents` → `RoomsCard` → `SectionCard` → `ReminderBanner`.
- Teacher page, in order: `StatusCard` ("Teaching"/"Free", section + group on the class card, both lab teachers) → `TodayList` / next-teaching-day preview + `WeekGrid` → `UpcomingEvents` → `RoomsCard` (+ link to `/rooms/free`) → `RosterCard` per taught section (expands, calls the roster endpoint) → `TeacherAccountCard` (linked code or "not linked yet" notice) + `ReminderBanner`.
- Loading / empty / error / data for each card; empty cards show a short message or are hidden; text labels with colour (accessibility); countdown not in an `aria-live` region, status is `aria-live="polite"`.
- Translation keys under `dashboard.*` (cards, empty messages, "Right now", "Tomorrow", "Not linked yet", group notice, semester badge, errors), no hard-coded strings.
- Account-state screens already exist (`AuthGate` routes non-`active` users away); the dashboard additionally shows an error card on `STATE_NOT_ALLOWED`.
- Refresh: reuse `useLiveStatus` (1 s tick, server offset), `useRoutineSocket` (`routine/booking/calendar.changed`), dashboard refetch on those events + every 5 min + on tab visible; free-now refetch every minute.

## Tests (mapped to the checklist)

Server (Vitest + Supertest, fixed fake clock, existing `test/harness.js` and routine test helpers):
- R1/R17 DSH-01: single call returns all keys; every non-`active` state (`email_unverified`, `claim_pending`, `unconfirmed`, `graduated`, teacher `pending`, `suspended`) → `403 STATE_NOT_ALLOWED`; unauthenticated → 401; staff-only → 403.
- R2 DSH-02: with a registered fake `messages` provider, release `R1` → no `messages` key and provider not called; `R3` → present (unit + API).
- R5/R9 DSH-09: G2 student's courses list the G2 lab teacher, not G1's; a student never sees another section's data.
- R10 DSH-10: student with no group → `reminders.group_missing`; bouncing/unverified email flagged; semester badge text.
- R7/R8/R15: `upcoming_events` limited to 14 days and own department; `free_now` present.
- R13 DSH-13: teacher requesting a not-taught section → 404; taught section → roster with `user_id, name, photo, uv_id, group` and **no** `email`/`phone` keys (deep key scan, also checks no `*_enc`/hmac keys); student, other-department admin, teacher of another section → 404; own-department admin and super admin → 200; `claim_pending`/`unconfirmed` student → `403 STATE_NOT_ALLOWED`.
- R16 DSH-16: unlinked teacher → `teacher_link.linked === false`, empty `sections_taught`, `/api/me/routine` empty; linked → code + name; phone/photo reminders.
- R11: shared lab slot lists both teachers (checked through the routine payload the card renders).
- Cross-scope per role: student cannot read a roster or another student's dashboard data; teacher cannot see another section's roster; dept admin of another department refused.
- Concurrency: none needed (read-only endpoints); stated in the report.

Shared: `features.test.js` (flag map, `isReleased`). Client (Vitest + Testing Library): `StatusCard` with fake server time (in class / free / event / no classes, `next.slot`), teacher label + both teacher names, `TodayList` current marked, tomorrow / next-teaching-day helpers, `SectionCard`, `RosterCard` (404 message), `ReminderBanner`, both pages with mocked API including R3-off (no messages card), unlinked-teacher notice, empty-card behaviour. Existing `my-routine.test.jsx` must still pass after the extraction.
Playwright (R19 DSH-01): 360 px viewport, CDP-throttled 4G, API routes mocked, main dashboard content visible within 2 s (smoke check on CI hardware).

## Build order (tests written with each step)

1. `shared/features.js` + test.
2. Helpers in `enrolments`, `routine` (`sectionCourses`), `auth` (`contactStatus`) with unit tests.
3. Dashboard module: policy, card registry, student card, teacher card, service, route; API tests for R1, R2, R5–R10, R14–R17.
4. Roster service + route + policy; API tests for R13 and cross-scope refusals.
5. Mount in `app.js`; run server tests.
6. Client extraction: `WeekGrid`, `DayList`, `StatusCard` (fix `next.slot`), run `my-routine` tests.
7. Dashboard hooks, cards, both pages, `HomePage` dispatcher, i18n; component and page tests.
8. Playwright DSH-01 test.
9. `run-checks` (lint, tests, build); walk the checklist; report. Save this plan to `implementation-plan/16-student-teacher-dashboards-plan.md` (repo root) first, after your approval.

## Out of scope

CR/DCR dashboard and CR/DCR roster access (spec 17); admin dashboard (18); messages, announcements, notifications, student-status/"free now" list for teachers, room request button and "My room requests" cards (R2/R3/later); a date/time picker embedded on the dashboard; "next teaching day" defaults in `GET /api/me/routine` (spec 12 behaviour unchanged); fixing unrelated stale tests (e.g. FND smoke tests that expect the old "Welcome" page); committing.

## Verification

`npm test -w @crm/shared`, `npm test -w @crm/server`, `npm test -w @crm/client`, `npm run lint`, `npm run build`, `npm run test:e2e -w @crm/client` (dashboard spec), then the checklist above with each item mapped to a passing test. Note: the working tree has uncommitted spec-15 changes; failures there are reported separately from mine. Node must be 24.22.2 (see memory: 24.15.0 kills vitest workers).


---

## Build notes (what was actually built, and where it differs from the plan above)

- `shared/schemas/dashboard.js` was **not** created. The roster route reuses the existing `sectionIdParam` (same 24-hex rule). A second export of the same name caused a build namespace conflict, which was removed.
- Cards live in `client/src/features/dashboard/components/`, not as `StudentDashboardPage.jsx` / `TeacherDashboardPage.jsx`. `DashboardPage` takes a `kind` prop, and `routes/HomePage.jsx` dispatches by `me.user.kind`. Staff accounts keep the placeholder until spec 18.
- `FreeRoomsNowCard` was **not** changed. The dashboard's `RoomsCard` renders the `free_now` data from the dashboard summary, so there is no second request.
- The week grid, day list and live status card were moved into `client/src/features/routine/components/` (`WeekGrid`, `DayList`, `LiveStatusCard`) and are shared by My routine and the dashboard. `next` in the status card now reads `next.slot` (the earlier inline card read the wrong fields).
- Helpers added: `contactStatus` (`auth/contact.service.js`), `sectionCoursesFor` (`routine`), `listAcceptedOfSection`, `countAcceptedBySection`, `approvedUvIds` (`enrolments`). Route mounts added to `app.js`.
- Dashboard API tests cover DSH-01, 02, 07, 08, 09, 10, 13, 15 and 16, plus cross-scope refusals. `cards.test.js` was folded into `dashboard.api.test.js`.
- The 'Welcome' heading assertions in `AppShell`, `AuthGate`, `auth-forms` and `profile` tests were changed to 'Dashboard'. A student's landing page is now the dashboard (spec 16), so the old assertion no longer matched.
- Verification fixes (second pass): the countdown now shows a real duration ("in 1 h 10 min", "Class ends in 25 min"), with the teacher and room; a next class on another day shows its date (RTN-10). The teacher week cell shows section and group (DSH-12). The CR/DCR photo is shown (DSH-09). The teacher dashboard embeds the date and time picker of the free-room view (DSH-14), shared as FreeRoomsFinder with the free-room page. The dashboard title shows while loading.
- Playwright (`client/e2e/dashboard.spec.js`): the API is mocked with a 150 ms delay per call, and the app shell is warmed before timing. It checks the 2 s budget and the 360 px no-horizontal-scroll rule. It is a smoke check, not a 4G measurement.
- Spec status left at `Draft`. The spec tasks are still unticked; the requirement tests are listed in the verification pass.
- Prettier: `npm run format:check` reports 89 files, mostly in other specs. Four of them (`enrolment.service.js`, `routine/index.js`, `shared/schemas/index.js`, `calendar/index.js`) already failed at HEAD, so they were not reformatted here.
