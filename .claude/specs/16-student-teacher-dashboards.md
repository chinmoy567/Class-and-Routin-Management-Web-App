# 16: Student and teacher dashboards

R1 · Status: Draft · Depends on: 12, 13 · PRD: Student dashboard, Teacher dashboard, Core features (F7b, F7c), Non-functional requirements (Targets: page speed) · Diagrams: 24-sitemap

## Goal

The first page an `active` student or teacher sees: a summary of right now, the routine, notices, rooms, their section (students) or rosters (teachers), and profile reminders. Each card links to the full feature. Cards for features in later releases stay hidden.

## Scope

**In:** the student dashboard, the teacher dashboard, the teacher's section rosters, card visibility by release, the dashboard summary endpoint.

**Out:** CR/DCR dashboard (spec 17), admin dashboard (spec 18), message/announcement/notification cards (they appear with R3 and later releases).

## Requirements

### Shared
- **DSH-01** One call, `GET /api/me/dashboard`, returns the data for every card the user may see, so the page loads in under 2 seconds at the 95th percentile on a mid-range Android phone on 4G. The routine data comes from `GET /api/me/routine` (spec 12), loaded in parallel.
- **DSH-02** Card visibility follows a release flag map in `shared/features.js` (`R1`, `R2`, `R3`, `LATER`). A card for a feature not yet released is not rendered and its data isn't requested.
- **DSH-03** Cards stack in one column on phones in this priority order: status and countdown, today's classes, notices, rooms, section (students) or students (teachers), profile reminders. A card with nothing to show is hidden or shows a short empty message, never a blank box.
- **DSH-04** Status and countdown refresh on their own (spec 12 RTN-12), without reloading the page.

### Student dashboard
- **DSH-05** **Right now:** live status, countdown, and the current or next class card (course, the full name of the teacher of the student's group, room, time).
- **DSH-06** **Routine:** today's classes in time order with the current one marked, the full week grid (Sunday–Thursday, today highlighted, a day list on phones), and a tomorrow preview (first class tomorrow and its start time).
- **DSH-07** **Notices:** upcoming calendar events for the next 14 days (spec 11). Messages (R3), announcements and notifications (later releases) stay hidden.
- **DSH-08** **Rooms:** "free rooms now" (spec 13), view only.
- **DSH-09** **My section:** the CR and DCRs (name, photo; message button from R3), courses this semester with the full name of the teacher of the student's group for each (from the routine), and a link to the CR/DCR dashboard if the student holds the role.
- **DSH-10** **Profile reminders:** level, term, section and group read-only, the semester badge ("Fall 2026 confirmed"), an email banner if the email is bouncing or unverified, and a group notice if no group is set.

### Teacher dashboard
- **DSH-11** **Right now:** "Teaching" or "Free" (spec 12 RTN-13), countdown, and the current or next class card (course, section, group, room, time). For a lab shared with another teacher, both full names are shown.
- **DSH-12** **My routine:** today's classes across all sections, the week grid where each cell shows course, section, group and room, and a next-teaching-day preview when no classes remain today.
- **DSH-13** **Students:** for each section the teacher teaches (spec 06 TCH-16), a roster with each student's name, UV ID and group. Opening a roster of a section the teacher doesn't teach → `404`. Phone and email are never shown.
- **DSH-14** **Rooms:** free rooms with a date and time picker (spec 13). The request button and "My room requests" appear in R2 (spec 19).
- **DSH-15** **Messages and notices:** upcoming calendar events for the next 14 days. Messages (R3), notifications and announcements (later releases) stay hidden.
- **DSH-16** **Account:** linked short code and name, or the "not linked yet" notice (spec 06 TCH-11), plus profile reminders when phone or photo is missing.

## Permissions

| Endpoint | Who |
|---|---|
| `GET /api/me/dashboard` | `active` students and teachers (other states are sent to their screen by `next`) |
| `GET /api/sections/:id/roster` | teachers who teach the section; CR/DCR of the section (spec 17); admins of the section's department |

## Data

No new collections.

## API

| Method and path | Who | Success | Errors |
|---|---|---|---|
| `GET /api/me/dashboard` | see above | `{ kind, section?, representatives?, courses?, upcoming_events, free_now, reminders, teacher_link?, sections_taught? }` | `STATE_NOT_ALLOWED` |
| `GET /api/sections/:id/roster` | see above | `[{ user_id, name, photo, uv_id, group }]` (CR/DCR also get `confirmed_this_semester`) | `NOT_FOUND` |

## Screens

Student dashboard and teacher dashboard as described, built from shared card components (`StatusCard`, `TodayList`, `WeekGrid`, `UpcomingEvents`, `FreeRoomsNow`, `SectionCard`, `RosterCard`, `ReminderBanner`).

## Acceptance tests

- DSH-02: with R3 disabled, the response and page contain no messages card.
- DSH-09: a G2 student's course list shows the G2 lab teacher, not G1's.
- DSH-10: a student with no group sees the group notice.
- DSH-13: a teacher requesting the roster of a section they don't teach → `404`. Roster entries have no phone or email keys.
- DSH-16: an unlinked teacher sees the notice and an empty routine.
- DSH-01: Playwright on a 360 px viewport with network throttled to 4G: the dashboard's main content renders within 2 s (on CI hardware, as a smoke check).

## Decisions and open questions

- **Decision:** one summary endpoint plus the routine endpoint, rather than one request per card, to meet the 2-second target on 4G.

## Tasks

- [ ] `shared/features.js` release flags
- [ ] Dashboard summary service (student, teacher)
- [ ] Roster endpoint with taught-sections check
- [ ] Card components + both dashboard pages (phone first)
- [ ] Tests + Playwright phone check
