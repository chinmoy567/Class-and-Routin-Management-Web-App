# 19: Room booking

R2 · Status: Draft · Depends on: 13, 18 · PRD: Classroom booking rules, Core features (F9), CR/DCR dashboard (Act), Teacher dashboard (Rooms), Admin dashboard (Room requests waiting), Technical approach (room_request, room_slot_lock, Concurrency rules), Acceptance criteria (Booking) · Diagrams: 11-activity-room-booking, 16-seq-room-request, 21-state-room-request

## Goal

A CR, DCR or approved teacher requests a free room for a dated time range at least 12 hours ahead. An admin of a department that owns or shares the room approves one request. Approval is guaranteed to never double-book (database-level lock), cancels the requester's other overlapping requests, and rejects other requests for the same room and time. Undecided requests expire 2 hours before the start.

## Scope

**In:** sending requests with all checks, the 3-overlapping-request limit, the admin's decision queue, approval and rejection, expiry, cancellation, no-show notes, effects on routine, status and free rooms, and the hooks from routine edit and calendar.

**Out:** nothing else in the PRD. Booking penalties beyond a note are out of scope for the first version.

## Requirements

### Who and what
- **BKG-01** Requesters: a CR or DCR (in effect) on behalf of their **section**, and an `active`, linked teacher on their own behalf. Ordinary students can't request (`403`).
- **BKG-02** A request is one room, one date, one time range: start and end on 5-minute boundaries, 30 minutes to 3 hours long, between 08:00 and 18:00. It has a note (5–300 characters) and a **target section** (a CR/DCR can only target their own section, a teacher only a section they teach), plus an optional target group. A CR/DCR may name a teacher from the section's teachers.
- **BKG-03** The system records which CR/DCR sent a section's request (`sent_by_user_id`).

### Checks when sending (all must pass; each failure has its own code)
- **BKG-04** `ROOM_NOT_FREE`: no running published slot and no approved booking overlaps the room (spec 13 `availability`). Pending requests don't block.
- **BKG-05** `AVAILABILITY_UNKNOWN`: the room must be availability known (spec 13 FRV-02).
- **BKG-06** `TARGET_BUSY`: the target section (or group) has no running class and no approved booking overlapping. A whole-section class blocks every group, and a group's lab blocks a whole-section request.
- **BKG-07** `TEACHER_BUSY`: the requesting teacher, or the teacher named on a CR/DCR request, has no running class and no approved booking overlapping.
- **BKG-08** `NOT_TEACHING_DAY`: the date is Sunday–Thursday, inside the current semester, and not closed by a calendar event. On an early-closing day the range must end by the cutoff.
- **BKG-09** `TOO_LATE`: sent at least 12 hours before the start (institution time).
- **BKG-10** `OUTSIDE_WINDOW`: the date is in the current or next week (Sunday–Saturday).
- **BKG-11** `REQUEST_LIMIT`: the requester (section, shared by its CR and DCRs, or teacher) has fewer than 3 **pending** requests overlapping this time on this date. Counted inside the transaction after a write to the requester's document (mongo-patterns §6).

### Deciding
- **BKG-12** Deciders: the admin of the room's owning department or of any sharing department, or a super admin. The queue lists pending requests for their rooms, grouped by room and slot, oldest first, showing the requester's section or department, the note, and the requester's other requests for the same time.
- **BKG-13** **Approve** runs as one transaction (mongo-patterns §5): a conditional update `pending → approved`, re-run every send-time check except the 12-hour rule, insert the `room_slot_lock` documents (5-minute blocks), cancel the requester's other pending requests that overlap (reason `another_request_approved`), and reject other requesters' pending requests that overlap the same room (reason `room_given_to_another`). A duplicate-key error on the lock or a failed conditional update → `409 ALREADY_DECIDED`.
- **BKG-14** **Reject** needs no reason (optional note) and is a conditional update.
- **BKG-15** Decisions are allowed only until **2 hours before the start** (`DECISION_CUTOFF_PASSED`). The first decision is final.
- **BKG-16** Every requester is told the result by email. A requester who loses is told the room went to another section. Approval or cancellation also emails the target section's students and the teacher (spec 15).

### Expiry
- **BKG-17** A job marks pending requests as `expired` once 2 hours before their start has passed, and emails the requester. Idempotent (conditional update).

### Effects of a booking
- **BKG-18** An approved booking appears as a dated one-off class in the target section's (or group's) routine, My routine and live status (spec 12 `bookings`), and in the routine and status of the requesting or named teacher. It never changes the weekly routine.
- **BKG-19** The room shows as `booked` in the free-room view to everyone, with no requester details. New requests for an overlapping time are refused even from a stale screen (checks run on the server).
- **BKG-20** Pushes `booking.changed` to affected sections, teachers and everyone viewing free rooms.

### Cancelling and no-shows
- **BKG-21** The requester (for a section: any of its CR/DCRs) can cancel a pending or approved request at any time before it ends. An approved cancellation deletes its locks in the same transaction, so the room is free at once. A cancellation less than 6 hours before the start is flagged `late_cancel` and visible to the admin.
- **BKG-22** A decider can cancel an approved booking (reason required), with the same effects and emails.
- **BKG-23** After the slot, a decider can add a no-show note to an approved request. It stays on record and is shown next to that requester's future requests. No other penalty.

### Hooks from other specs
- **BKG-24** Routine edit (spec 08 EDT-05) and import (spec 07 IMP-19) list approved future bookings that clash with a new class. If the admin chooses to cancel the booking, BKG-22 applies.
- **BKG-25** A calendar event that closes a day or cuts it short (spec 11 CAL-13) cancels the affected approved bookings and emails the requesters. Pending requests on those days expire.

### Screens on the dashboards
- **BKG-26** CR/DCR and teacher dashboards get the request button on free rooms and a "My room requests" list (pending, approved, rejected, cancelled, expired, with reasons). The admin dashboard gets the "Room requests waiting" card (spec 18 ADM-06), and the digest lists them by decision cutoff.

## Permissions

| Action | CR/DCR (section) | Teacher (active, linked) | Admin of owner/sharing dept | Super admin | Student |
|---|---|---|---|---|---|
| Send request | own section | sections they teach | ✘ (unless also teacher) | ✘ | ✘ |
| Cancel own / section's request | ✔ | own | n/a | n/a | ✘ |
| View queue, approve, reject | ✘ | ✘ | ✔ | ✔ | ✘ |
| Cancel approved booking, no-show note | ✘ | ✘ | ✔ | ✔ | ✘ |

## Data

- `room_request`: requester_section_id? | requester_teacher_id?, sent_by_user_id, target_section_id, target_group_id?, named_teacher_id?, room_id, date, start_min, end_min, note, status (`pending` | `approved` | `rejected` | `cancelled` | `expired`), reason?, decided_by?, decided_at?, cancelled_by?, late_cancel?, no_show_note?, version, created_at. Indexes: `{ room_id, date, status }`, `{ requester_section_id, date, status }`, `{ requester_teacher_id, date, status }`, `{ target_section_id, date, status }`, `{ status, date, start_min }` (expiry job).
- `room_slot_lock`: room_id, date, block_start, room_request_id. Unique `{ room_id, date, block_start }`.
- `section.request_seq`, `teacher.request_seq` (numbers) for the limit check.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/room-requests` | requesters | room_id, date, start, end, note, target_section_id, target_group_id?, named_teacher_id? | 201 | the codes in BKG-04–BKG-11, `FORBIDDEN` |
| `GET /api/me/room-requests` | requesters | none | own (or section's) requests | none |
| `GET /api/admin/room-requests?status=pending` | deciders | none | grouped queue | none |
| `POST /api/room-requests/:id/decision` | deciders | decision, note? | 200 | `ALREADY_DECIDED`, `DECISION_CUTOFF_PASSED`, and the re-checked codes |
| `POST /api/room-requests/:id/cancel` | requester, decider | reason? | 200 | `ALREADY_DECIDED`, `TOO_LATE` (already ended) |
| `POST /api/room-requests/:id/no-show` | decider | note | 200 | `TOO_EARLY` |

## Jobs and events

- `booking.expire`: every 5 minutes.
- Emails: `room_request_result`, `booking_cancelled`, `request_expired`.
- `booking.changed` after commit.

## Acceptance tests

- [PRD] Given room 311 is free 11:35–12:30 on Wed 11 Nov 2026, when a CR requests it at 23:34 on Tue 10 Nov, then it is accepted. At 23:36, then it is blocked by the 12-hour rule.
- [PRD] Given a section with 3 open requests overlapping 11:00–12:00, when a DCR of that section sends a 4th overlapping request, then it is blocked. A request for 14:00–15:00 the same day is accepted.
- [PRD] Given two pending requests for room 311, 11:35–12:30, from sections X and Y, when admins from two sharing departments approve them at the same moment, then exactly one is approved and the other admin sees "already decided".
- [PRD] Given an approved request for X at 11:35–12:30, then X's other requests overlapping that time are cancelled, and Y's request for room 311 at an overlapping time is rejected.
- [PRD] Given section X has a lab 11:35–13:15 for G1, when a teacher requests a room for all of X at 12:00–13:00, then it is blocked ("target section has a class").
- [PRD] Given a pending request with no decision by 2 hours before its start, then it becomes "expired" and the requester is emailed.
- [PRD] Given a room shared with EEE while EEE has not published its routine for the current semester, then the room shows "Availability unknown" and cannot be requested.
- [PRD] Given a university `exam` event on Mon 7 Jun 2027, no room can be requested that day.
- BKG-11: 4 overlapping requests from the CR and DCR of one section sent at the same moment → exactly 3 pending.
- BKG-13: approvals for 10:00–11:00 and 11:00–12:00 in the same room both succeed (touching ranges).
- BKG-18: after approval, a target-section student's live status shows "In class" during the booking.
- BKG-21: cancelling an approved booking makes the room `free` in the next availability query.
- A plain student sending a request → `403`.

## Decisions and open questions

- **Decision:** lock blocks are 5 minutes, not 10 (the PRD's example), because request times are on 5-minute boundaries. 10-minute blocks would make touching ranges such as 10:00–11:05 and 11:05–12:00 clash.
- **Decision:** the approval re-checks every rule except the 12-hour rule (the admin decides later than the request was sent, and the decision cutoff covers lateness).
- **Open (PRD Open question 2):** which departments go live together. Rooms shared with departments that aren't live stay "Availability unknown".

## Tasks

- [ ] `room_request`, `room_slot_lock` models + indexes
- [ ] Check functions (pure where possible) for BKG-04–BKG-10
- [ ] Send transaction with the limit (BKG-11)
- [ ] Decision queue + approve/reject transactions
- [ ] Expiry job, cancel, no-show
- [ ] Hooks into spec 07/08/11, bookings in spec 12/13 responses
- [ ] Emails, events, audit
- [ ] Request dialog, My room requests, admin queue screens
- [ ] Tests incl. every PRD booking criterion and concurrency tests
