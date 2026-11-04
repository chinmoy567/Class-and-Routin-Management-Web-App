# 12: My routine and live status

R1 · Status: Approved · Depends on: 04, 05, 06, 07, 10, 11 · PRD: My routine (student view), Sessional groups, Live class status, Teacher dashboard (My routine), Core features (F7, F7a, F12, F13), Non-functional requirements (Performance) · Diagrams: 14-activity-live-status, 25-routine-resolution

## Goal

A student opens the app and sees their own routine, picked automatically from the section and group their CR/DCR accepted. A teacher sees their own classes. Both see live "In class / Free" status and a countdown, computed on the page from server time so a wrong device clock never matters.

## Scope

**In:** routine resolution for students and teachers, the `GET /api/me/routine` endpoint, teacher full names, the week grid and today list, the live status and countdown rules, refreshing, the per-section cache.

**Out:** the dashboard layout around these (spec 16), the CR/DCR section view (spec 17), teacher view of students' status (later release).

## Requirements

### Which slots
- **RTN-01** A student's routine = published slots of the **current** semester where `section_id` = their accepted enrolment's section and (`group_id` is empty, or equals their group). With no group set, only whole-section slots are returned, plus `group_missing: true`.
- **RTN-02** A section's routine includes every department's published slots for it (union of slot owners).
- **RTN-03** A teacher's routine = published slots of the current semester linked (through `routine_slot_teacher`) to any teacher record linked to their account. Each slot shows section and group. A teacher account with no linked teacher record gets an empty routine, not an error.
- **RTN-04** Only `active` students and `active` teachers can call these endpoints. Other states → `403 STATE_NOT_ALLOWED` (the client shows the waiting or update screen).
- **RTN-05** A student never receives slots of another group of their section or of another section.

### The endpoint
- **RTN-06** `GET /api/me/routine?from=YYYY-MM-DD&to=YYYY-MM-DD` returns the data below. Both dates are inclusive, and the range is at most 14 calendar days (`to − from ≤ 13`). The default range is today to the next teaching day. The page's status view always asks for today to today + 13, so the countdown has data for the 14 days it looks ahead (RTN-10). The response contains:
  - `server_time` (UTC ISO) and `timezone: 'Asia/Dhaka'`,
  - `semester` { name, start_date, end_date },
  - `week`: the weekly pattern (slots by weekday) for the grid,
  - `days`: for each date in the range, the `dayRule` and the slots that apply that date, each with `runs` / `stopped` / `cancelled` (from spec 11), effective start and end, course code and name, room code, teachers' full names (or "Teacher to be announced" for TBA), group label, and, for teachers, section,
  - `bookings`: approved bookings for the student's section/group or the teacher, as one-off classes (empty until spec 19),
  - `events`: calendar events in the range,
  - `group_missing` (students).
- **RTN-07** Teacher names are the full names from the teacher directory (spec 06), looked up by department + short code. A slot with two teachers lists both. The short code is also returned for small grid cells.

### Live status (computed on the page)
- **RTN-08** A pure function `liveStatus(routineResponse, serverNow)` in `shared/` returns one of:
  - `in_class`: { slot, ends_at } (a running slot or an approved booking contains now),
  - `free`: { next } (the next class that will really run, up to 14 days ahead),
  - `event`: { label } (a full-day event covers today, for example "Mid-term exam"),
  - `classes_over`: { label } (after an early-closing cutoff today: "Classes over today: Campus Day"),
  - `no_classes_today` (Friday or Saturday),
  - `no_semester` ("No classes", outside the semester dates).
- **RTN-09** A slot contains now when `start ≤ now < effective_end`. A cancelled slot counts as free time. An approved booking counts as a class.
- **RTN-10** The countdown: in class → time until the effective end ("Class ends in 25 min"). Free → time until the next running class, with course, teacher name and room ("Next class CSE-421 with Arifur Rahaman in 1 h 10 min, Room 311"). If none remain today, it counts down to the first class of the next teaching day, skipping event days.
- **RTN-11** The page computes the clock offset once per fetch (`server_time` − device time at the moment of the response) and uses `Date.now() + offset` for every calculation. A device clock 20 minutes fast doesn't change the status.
- **RTN-12** The status updates every minute without a server call (the countdown text may tick every second). The page refetches every 5 minutes, at once on a `routine.changed`, `booking.changed` or `calendar.changed` event that touches the user (their section or group, their own teaching slots, or a calendar event in their scope), and whenever the tab becomes visible again.
- **RTN-13** Teachers get the same function with "Teaching" instead of "In class" (labels only).

### Performance
- **RTN-14** The weekly pattern per section (and per teacher) is cached in server memory, keyed by semester + section (or teacher user). It is cleared on publish, slot edit, group change, link/unlink, and semester change. The 08:30 peak is served from this cache. Day rules, cancellations and bookings are read per request (small indexed queries).
- **RTN-15** `GET /api/me/routine` responds within 300 ms at the 95th percentile on a warm cache, with 2,000 users signing in within 5 minutes (checked by a load test in spec 23).

### Screens
- **RTN-16** My routine page: opens on today's classes, then the full week. Each class shows time, course, teacher full name(s) and room.
- **RTN-17** Week grid: days Sunday–Thursday against the nine period columns from the sheet, 08:30–09:25, 09:30–10:25, 10:30–11:25, 11:35–12:30, 12:35–13:30, 13:35–14:30, 14:35–15:30, 15:35–16:30 and 16:35–17:30 (the 24-hour times of the header row of `Dept of CSE Routine Spring 2026.xlsx`). A multi-period lab is one block across its periods. A class with its own times is placed at those times. Today is highlighted, the running class is marked, and the status and countdown are shown above. A cell shows the short code when narrow and the full name on tap.
- **RTN-18** On phones (under `md`), the grid becomes a day-by-day list with tabs for each day.
- **RTN-19** If `group_missing`, a notice says the CR or DCR must set a group, and only whole-section classes are shown.

## Permissions

| Endpoint | Who |
|---|---|
| `GET /api/me/routine` | `active` students, `active` teachers |

## Data

No new collections. The nine period columns (RTN-17) are config in `shared/periods.js`. Other departments' sheets may use other columns; changing the config must not need a code change elsewhere.

## API

| Method and path | Who | Query | Success | Errors |
|---|---|---|---|---|
| `GET /api/me/routine` | see above | from?, to? | see RTN-06 | `STATE_NOT_ALLOWED`, `VALIDATION_ERROR` (range > 14 days) |

## Jobs and events

Listens for `routine.changed`, `booking.changed` and `calendar.changed` on the client. The server's cache-clear hooks are called by specs 06, 07, 08, 10 and 14.

## Acceptance tests

- RTN-01: a G1 student doesn't receive G2's `CSE-422 (G2)` lab, but does receive whole-section classes. With no group set, only whole-section classes are returned, with `group_missing: true`.
- RTN-02: [PRD] LAW 1-II students see both LAW-owned and CSE-owned slots.
- RTN-03: a teacher linked to two teacher records gets every published slot linked to them this semester and no slot of another teacher. A teacher with no linked record gets an empty routine.
- RTN-04: a `claim_pending`, `unconfirmed`, `graduated` or `email_unverified` student → `403 STATE_NOT_ALLOWED`. A `pending` or `suspended` teacher → `403 STATE_NOT_ALLOWED`. [PRD] Given an `unconfirmed` student, when they open My routine, then they see the update screen.
- RTN-05: a student of G2 never receives G1's lab, and never receives another section's slots, even when they ask for a date range that contains them.
- RTN-06: the response contains every field in RTN-06 (`server_time` in UTC ISO, `timezone`, `semester`, `week`, `days`, `bookings: []`, `events`, `group_missing`). A range of 15 days → `400 VALIDATION_ERROR`.
- RTN-07: a TBA slot lists `Teacher to be announced`. A slot with two teachers lists both full names, and each entry includes the short code.
- RTN-08: [PRD] given a device clock 20 minutes fast, then the status still matches server time.
- RTN-08: [PRD] given an `early_closing` with cutoff 12:00, a class 11:35–12:30 shows in class until 12:00, then "Classes over today".
- RTN-08: on a Friday → `no_classes_today`. After the semester end → `no_semester`. On a holiday → `event` with its label.
- RTN-09: a cancelled slot at the current time → `free`.
- RTN-10: on Thursday evening, the countdown points to Sunday's first class. If Sunday is a holiday, it points to Monday.
- RTN-11: the offset is computed once per fetch. A later device-clock change does not change the status until the next fetch.
- RTN-12: a `routine.changed` event for the user's section refetches at once. Returning to a hidden tab refetches. Status recomputes every minute with no request (fake timers).
- RTN-13: a teacher of two groups of the same course sees both slots, with the section and group shown. The teacher's status says "Teaching", not "In class".
- RTN-14: after an import publish, the next call returns the new slots (cache cleared).
- RTN-15: covered by the load test in spec 23, not here.
- RTN-16 to RTN-19 (Playwright): the page opens on today's classes. The week grid shows Sunday–Thursday, the running class is marked, and a tap shows the full teacher name. Under `md` the day tabs replace the grid. With `group_missing`, the notice appears and only whole-section classes are listed.

## Decisions and open questions

- **Decision:** live status is a pure function in `shared/`, so the client and future server features (teacher view of students' status, later release) use exactly the same rules.
- **Decision:** an in-memory cache in the API process. This is fine for one server (spec 23). It must move if the app ever runs on more than one process.
- **Decision:** the nine period columns come from the CSE sheet (Spring 2026, `ROUTINE` tab header row). The PRD's first and last columns (08:30–09:25, 16:35–17:30) match it. Nothing is left open here.
- **Decision:** the client's status view asks for today to today + 13 days. The countdown can then look 14 days ahead without a second call, and an event or a cancellation that falls outside the window is not shown in the countdown.

## Tasks

- [ ] Routine resolver (student, teacher) + teacher-name lookup
- [ ] Section/teacher pattern cache with clear hooks
- [ ] `GET /api/me/routine` assembling days with `slotRuns`
- [ ] `shared/liveStatus.js` + `shared/periods.js` with unit tests (fake times)
- [ ] Client: server-time offset, status/countdown hook, refetch rules
- [ ] My routine page, week grid, phone day list, group-missing notice
- [ ] Tests incl. the PRD criteria
