# Plan: 12 – My Routine and Live Status

## Context

Spec 12 gives every active student and teacher a personalised `GET /api/me/routine` endpoint that assembles their weekly routine, applies the calendar resolver from spec 11, and returns structured day-by-day data with server time. A pure `liveStatus(response, serverNow)` function in `shared/` then lets the client compute "In class / Free" and the countdown without any extra server calls. The UI is the My Routine page (week grid + day list for phones) and the live-status card above it.

---

## Rules and acceptance criteria

**R1** `RTN-01` — Student routine = published slots of the current semester where `section_id` = their accepted enrolment's section AND (`group_id` is absent OR equals their group). With no group set, only whole-section slots + `group_missing: true`.

**R2** `RTN-02` — A section's routine includes every department's published slots for it (union of slot owners).

**R3** `RTN-03` — Teacher routine = published slots of the current semester linked (via `routine_slot_teacher`) to any teacher record linked to their account.

**R4** `RTN-04` — Only `active` students and `active` teachers may call `GET /api/me/routine`. All other states → `403 STATE_NOT_ALLOWED`.

**R5** `RTN-05` — A student never receives slots of another group of their section or of another section. Server must enforce this; hiding it in the UI is not enough.

**R6** `RTN-06` — Response shape:
  - `server_time` (UTC ISO), `timezone: 'Asia/Dhaka'`
  - `semester` { name, start_date, end_date }
  - `week` – weekly pattern (slots by day_of_week 0–4)
  - `days` – for each date in the requested range: `date`, `dayRule` result, and `slots[]` each containing: `slot_id`, `course_code`, `course_name`, `room_code`, `start_min`, `end_min`, `teachers` (full names + short codes, or TBA), `group`, `section` (teachers only), `status` (runs/stopped/cancelled), `effective_end_min`, `label`, `reason`
  - `bookings` – empty array until spec 19
  - `events` – calendar events covering the range visible to the caller
  - `group_missing` (boolean, students only)

**R7** `RTN-07` — Teacher names: `fullNames(ids)` from `teachers/directory.service.js`. TBA slots use `[{ short_code: 'TBA', full_name: 'Teacher to be announced' }]`.

**R8** `RTN-08` — Pure `liveStatus(routineResponse, serverNow)` in `shared/liveStatus.js` returns one of: `in_class { slot, ends_at }`, `free { next? }`, `event { label }`, `classes_over { label }`, `no_classes_today`, `no_semester`.

**R9** `RTN-09` — A slot contains now when `start_min ≤ minutesOfDay(now) < effective_end_min`. Cancelled slot = free. (Bookings as class: empty until spec 19.)

**R10** `RTN-10` — Countdown: in class → `ends_at` of running slot; free → next running slot's start up to 14 days ahead, skipping event days (no_semester / non_teaching_day / closed).

**R11** `RTN-11` — Client computes clock offset once per fetch: `offset = serverTime - Date.now()`. All subsequent calculations use `Date.now() + offset`. A device clock 20 min fast doesn't affect status.

**R12** `RTN-12` — Page refetches every 5 minutes, immediately on `routine.changed`, `booking.changed`, or `calendar.changed`, and on tab-visible. Status recomputes on the page every minute (countdown may tick per second).

**R13** `RTN-13` — `liveStatus` returns `in_class` for students; for teachers the same shape but `kind: 'teaching'` (display label "Teaching" instead of "In class").

**R14** `RTN-14` — Server-side section/teacher pattern cache: an in-memory Map keyed by `semesterId:sectionId` (or `semesterId:teacherUserId`). Cleared on: publish (`registerRoutineChangeListener`), slot edit, group change, teacher link/unlink (`registerLinkChangeListener`). Day rules, cancellations, bookings are read per request.

**R15** `RTN-15` — `GET /api/me/routine` responds within 300 ms at the 95th percentile on a warm cache (checked by spec 23 load test — no action needed here beyond implementing the cache).

**R16** `RTN-16` — My Routine page: opens on today's classes, then shows the full week.

**R17** `RTN-17` — Week grid: days Sun–Thu as columns, period rows 08:30–09:25 … 16:35–17:30 (defined in `shared/periods.js`). Today highlighted, running class marked, status+countdown above. Multi-period labs span their blocks. Short code when narrow, full name on tap.

**R18** `RTN-18` — Phone (< md): day-by-day list with tabs for each day.

**R19** `RTN-19` — `group_missing` notice: CR/DCR must set a group, only whole-section classes shown.

**Acceptance test — RTN-01**: G1 student doesn't receive G2's lab, does receive whole-section slots. No group → only whole-section + `group_missing: true`.

**Acceptance test — RTN-02**: A section that has slots owned by two departments returns all of them.

**Acceptance test — RTN-04**: `claim_pending` student → 403. `unconfirmed` student → 403.

**Acceptance test — RTN-08 (device clock)**: Given offset, liveStatus uses `serverNow`, not device time.

**Acceptance test — RTN-08 (early_closing)**: Class 11:35–12:30, cutoff 12:00 → in_class with ends_at = 12:00; after 12:00 → classes_over.

**Acceptance test — RTN-08 (Friday)**: → no_classes_today.

**Acceptance test — RTN-08 (holiday)**: → event with label.

**Acceptance test — RTN-09**: Cancelled slot at current time → free.

**Acceptance test — RTN-10**: Thursday evening → countdown to Sunday first class; if Sunday is a holiday, to Monday.

**Acceptance test — RTN-13**: Teacher gets same function, kind = 'teaching'.

**Acceptance test — RTN-14**: After publish, cache cleared; next call returns updated slots.

---

## Blockers / open questions

The spec's own open question: **"Confirm the exact period columns from the CSE sheet."** The PRD names 08:30–09:25 as the first and 16:35–17:30 as the last. For now define 9 standard periods (08:30–09:25, 09:25–10:20, 10:20–11:15, 11:15–12:10, 12:10–13:05, 13:05–14:00, 14:00–14:55, 14:55–15:50, 15:50–16:45) plus a 10th 16:45–17:30 to cover the last slot — stored in `shared/periods.js` as a constant, easy to adjust without code changes. All other rules are clear; no blocking questions.

---

## Files

### New (server)
```
server/src/modules/routine/my-routine.service.js   — query + assemble response
server/src/modules/routine/routine-cache.js        — in-memory pattern cache
server/src/modules/routine/my-routine.routes.js    — GET /api/me/routine
server/src/modules/routine/my-routine.controller.js
server/src/modules/routine/__tests__/my-routine.api.test.js
```

### New (shared)
```
shared/liveStatus.js      — pure liveStatus(response, serverNow)
shared/periods.js         — PERIODS constant (9 × 55-min periods + 1 short)
shared/__tests__/liveStatus.test.js
```

### Modified (server)
```
server/src/modules/routine/index.js    — export new router + registerRoutineChangeListener clears cache
server/src/app.js                      — mount myRoutineRouter
server/src/modules/teachers/directory.service.js  — registerLinkChangeListener clears teacher cache
```

### Modified (shared)
```
shared/index.js            — export liveStatus, PERIODS
```

### Modified (client)
```
client/src/lib/query-keys.js          — add qk.myRoutine(from, to)
client/src/features/routine/api.js    — fetchMyRoutine(from, to)
client/src/features/routine/hooks.js  — useMyRoutine(), useRoutineSocket()
client/src/routes/MyRoutinePage.jsx   — week grid + day list + status card
client/src/components/AppShell.jsx    — add /routine nav link (read first)
client/src/i18n/en.json               — routine.* keys
```

---

## Data model

No new collections. All data comes from:
- `routine_slot` + `routine_slot_teacher` (existing)
- `enrolment` (existing, `status: 'accepted'` for current semester)
- `teacher` records (existing)
- `calendar_event` + `class_cancellation` (spec 11, existing)
- `section_group` (existing)
- `room` (existing, for room code)

In-memory cache: `Map<string, SlotSummary[]>` — serialisable plain objects, no Mongoose docs. Key: `"s:{semesterId}:{sectionId}"` for sections, `"t:{semesterId}:{teacherUserId}"` for teachers.

---

## API

### `GET /api/me/routine?from=YYYY-MM-DD&to=YYYY-MM-DD`

**Auth:** `requireAuth`  
**Who:** `active` students, `active` teachers — others get `403 STATE_NOT_ALLOWED`  
**Query Zod schema:** `{ from?: dateString, to?: dateString }`, range max 14 days → `VALIDATION_ERROR`  
**Default range:** today to `today + 1` (two days, guaranteed to include today plus tomorrow if it's a teaching day)  
**No audit entry** — read-only endpoint  
**Response:**
```json
{
  "data": {
    "server_time": "2027-04-07T04:30:00.000Z",
    "timezone": "Asia/Dhaka",
    "semester": { "name": "Spring 2027", "start_date": "2027-04-04", "end_date": "2027-08-04" },
    "week": [ { "day_of_week": 0, "slots": [...] }, ... ],
    "days": [ { "date": "2027-04-07", "dayRule": { "kind": "normal" }, "slots": [...] } ],
    "bookings": [],
    "events": [...],
    "group_missing": false
  }
}
```

**`can()` check:** `routine.my.read` policy — `user.state === 'active'` (both kinds).

---

## Shared: `liveStatus(response, serverNow)`

```
Input: the full GET /api/me/routine response data, plus serverNow (ms timestamp)
Output: { kind, slot?, ends_at?, next?, label? }
  kind: 'in_class' | 'teaching' | 'free' | 'event' | 'classes_over' | 'no_classes_today' | 'no_semester'
```

Algorithm (runs for today's date in Asia/Dhaka derived from serverNow):
1. `dayRule` for today → kind
2. `no_semester` → return `{ kind: 'no_semester' }`
3. `non_teaching_day` → return `{ kind: 'no_classes_today' }`
4. `closed` → return `{ kind: 'event', label }`
5. Find today's slots with `status: 'runs'`
6. Find slot where `start_min ≤ minutesNow < effective_end_min` → `in_class` / `teaching`
7. If `cutoff` and minutesNow ≥ cutoff_min and no slot running → `classes_over`
8. Otherwise find next slot today or in next 14 days → `free { next }`

---

## UI

### `client/src/routes/MyRoutinePage.jsx`
- Shows live status card at top (uses `liveStatus` hook that ticks every second for countdown, recomputes status each minute)
- Week grid (desktop ≥ md): days Sun–Thu as columns, PERIODS as rows; each cell shows course code + room; running cell highlighted; hover/tap shows full teacher name
- Day list (mobile < md): tabbed by day; today is default tab
- `group_missing` banner when true

### `client/src/features/routine/`
- `api.js` — `fetchMyRoutine(from, to)` via `api('/me/routine', ...)`
- `hooks.js` — `useMyRoutine()` (TanStack Query), `useLiveStatus()` (setInterval every second, recomputes from cached response), `useRoutineSocket()` (listens to routine.changed / booking.changed / calendar.changed → invalidate `qk.myRoutine`)

### Translation keys
```json
"routine": {
  "title": "My Routine",
  "statusInClass": "In class",
  "statusTeaching": "Teaching",
  "statusFree": "Free",
  "statusNoClasses": "No classes today",
  "statusNoSemester": "No classes",
  "statusEvent": "{{label}}",
  "statusClassesOver": "Classes over today: {{label}}",
  "countdownEndsIn": "Class ends in {{time}}",
  "countdownNextIn": "Next class {{course}} in {{time}}",
  "countdownNextRoom": "Room {{room}}",
  "groupMissing": "Your group has not been set yet. Ask your CR or DCR to set it.",
  "tba": "Teacher to be announced",
  "noSlotsToday": "No classes today",
  "week": "Week",
  "today": "Today"
}
```

---

## Tests

Map to checklist numbers:

| Test | Checklist |
|---|---|
| Student G1 doesn't get G2 lab | R1, RTN-01 |
| Student with no group gets only whole-section + group_missing | R1, RTN-01 |
| Union of departments' slots in one section | R2, RTN-02 |
| Teacher gets slots via routine_slot_teacher | R3, RTN-03 |
| `claim_pending` student → 403 | R4, RTN-04 |
| `unconfirmed` student → 403 | R4, RTN-04 |
| Active student receives routine | R4 |
| Student never gets other section's slots | R5, RTN-05 |
| Response shape has all required fields | R6, RTN-06 |
| TBA slot returns "Teacher to be announced" | R7, RTN-07 |
| liveStatus: in_class when slot straddles now | R8, RTN-08 |
| liveStatus: free when no slot contains now | R8 |
| liveStatus: no_classes_today on Friday | R8 |
| liveStatus: event on holiday | R8 |
| liveStatus: classes_over after cutoff | R8 |
| liveStatus: no_semester outside semester | R8 |
| liveStatus: device clock offset doesn't matter | R11 |
| Cancelled slot at current time → free | R9, RTN-09 |
| Countdown skips to Sunday (then Monday if holiday) | R10, RTN-10 |
| Teacher kind = 'teaching' | R13, RTN-13 |
| Publish clears cache; next call gets new slots | R14, RTN-14 |
| Range > 14 days → 400 VALIDATION_ERROR | R6 |

---

## Build order

1. `shared/periods.js` + `shared/liveStatus.js` + unit tests (`shared/__tests__/liveStatus.test.js`). Run to confirm all pass.
2. Export from `shared/index.js`.
3. `server/src/modules/routine/routine-cache.js` — in-memory Map, `clearSectionCache(semesterId, sectionId)`, `clearTeacherCache(semesterId, userId)`, `clearAllForSemester(semesterId)`.
4. `server/src/modules/routine/my-routine.service.js` — `getMyRoutine(actor, { from, to })`:
   - student path: find accepted enrolment → section → cached slots → apply calendar → assemble days
   - teacher path: find teacher records → cached slots → assemble days
5. Policy rule `routine.my.read` in a new or extended policy file.
6. `my-routine.controller.js` + `my-routine.routes.js` → mount in `app.js`.
7. Register cache-clear listeners:
   - In `routine/index.js`: `registerRoutineChangeListener` → clear section caches for changed sections; register teacher link listener → clear teacher caches.
   - In `my-routine.routes.js` registration: register the section cache-clear hook once on module load.
8. API tests (`__tests__/my-routine.api.test.js`) covering all acceptance tests.
9. Client: `query-keys.js`, `features/routine/api.js`, `features/routine/hooks.js`, `MyRoutinePage.jsx`, i18n keys, route in `App.jsx`.

---

## Out of scope

- Bookings as one-off classes (spec 19 — `bookings: []` always)
- Teacher view of students' status (F14, later release)
- Ramadan timetable (later release)
- Dashboard layout around the routine card (spec 16/17)
- CR/DCR section view (spec 17)
- Load test (spec 23)
