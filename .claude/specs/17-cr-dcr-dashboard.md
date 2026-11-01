# 17: CR/DCR dashboard

R1 (room-request parts in R2) · Status: Draft · Depends on: 10, 12 · PRD: CR/DCR dashboard, Core features (F9a), Account states and access (Rosters) · Diagrams: 24-sitemap

## Goal

A dashboard for the CR and DCRs of **one section in one semester**: monitor the roster, unconfirmed students, the section's routine and live status, and act by deciding join requests, changing groups, sending reminders and flagging problems to the admin. It disappears the moment the role ends.

## Scope

**In:** dashboard access, the roster with confirmation status, unconfirmed students and reminders, section routine and live status per group, join request inbox (from spec 10), group changes, flags to the admin, the free-room view.

**Out:** room requests (R2, spec 19 adds them to this dashboard), announcements and removal requests (later release).

## Requirements

### Access
- **CRD-DSH-01** Only a student with a CR or DCR role **in effect** for a section of the current semester can open that section's dashboard. Every endpoint checks the role on each request, so a removed role loses access at once (`404`).
- **CRD-DSH-02** The dashboard never shows another section's students, requests or flags. The student's own student dashboard links to it.

### Monitor
- **CRD-DSH-03** **Roster:** every accepted student of the section with name, UV ID, group, photo and whether they're confirmed for this semester. Never phone or email.
- **CRD-DSH-04** **Unconfirmed students:** students who were in the matching section last semester (spec 09 CRD-07) or who applied to this section, and aren't yet accepted this semester, excluding "not enrolled". Each has a "send reminder" button, limited to one reminder per student per day across all the section's CR/DCRs (`429 RATE_LIMITED`).
- **CRD-DSH-05** **Section routine:** the section's published routine, today's classes first, with which classes are running now.
- **CRD-DSH-06** **Live status:** the section's status, and each group's status, with countdowns, using the same `liveStatus` function (spec 12) applied to the section and each group.
- **CRD-DSH-07** **Free rooms:** the free-room view (spec 13). The request button appears from R2.
- **CRD-DSH-08** **Flags:** the status (open, fixed, rejected) of every flag raised by this section's CR/DCRs this semester, with the admin's reply.

### Act
- **CRD-DSH-09** **Join requests:** the pending (not escalated) requests for the section, with accept / accept-with-group / reject (spec 10 JR-09–JR-11). Rejected requests and escalated ones are listed read-only.
- **CRD-DSH-10** **Change group:** on the roster, pick a group (or none) for any accepted student (spec 10 JR-16).
- **CRD-DSH-11** **Flag a problem:** category (`wrong_section`, `wrong_group`, `missing_student`, `routine_mistake`, `other`), an optional student from the roster, and a description (10–1,000 characters). At most 5 flags per CR/DCR per day (`429 FLAG_LIMIT`). The flag goes to the admins of the section's department, who see who raised it and when, and can mark it fixed or rejected with a reply (spec 18).
- **CRD-DSH-12** Every action on the dashboard is audited with who and when. The admin can see the log (spec 18).
- **CRD-DSH-13** When a CR/DCR loses the role, open flags they raised stay with the admin and remain visible to the section's remaining CR/DCRs.

## Permissions

| Action | CR/DCR of section (in effect) | Admin of dept | Others |
|---|---|---|---|
| View dashboard, roster, unconfirmed, routine, status, flags | ✔ | ✔ (read, via admin screens) | ✘ |
| Decide join requests, change group | ✔ | ✔ | ✘ |
| Send reminder | ✔ (1 per student per day) | ✔ | ✘ |
| Raise flag | ✔ (5 per day) | n/a | ✘ |
| Resolve flag | ✘ | ✔ | ✘ |

## Data

- `flag`: section_id, semester_id, raised_by, category, student_id?, description, status (`open` | `fixed` | `rejected`), reply?, resolved_by?, resolved_at?, created_at. Index `{ section_id, created_at: -1 }`, `{ status, created_at }`.
- `reminder_log`: section_id, student_id, date (YYYY-MM-DD). Unique `{ student_id, date }`.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/cr/sections/:id/overview` | CR/DCR of section | none | roster, unconfirmed, flags, counts | `NOT_FOUND` |
| `GET /api/cr/sections/:id/routine` | CR/DCR of section | none | section routine + per-group days (same shape as spec 12) | `NOT_FOUND` |
| `POST /api/cr/sections/:id/reminders` | CR/DCR of section | student_id | 202 | `RATE_LIMITED`, `NOT_FOUND` |
| `POST /api/cr/sections/:id/flags` | CR/DCR of section | category, student_id?, description | 201 | `FLAG_LIMIT`, `VALIDATION_ERROR` |
| Join request endpoints | CR/DCR | see spec 10 | | |

## Jobs and events

- Email `semester_update_reminder` for reminders (spec 15).
- Flags appear in the admin digest (spec 15).

## Screens

CR/DCR dashboard: section header ("CSE 2-II-A · Fall 2026 · you are CR"), tabs or cards for Join requests (with count), Roster (group control), Unconfirmed (reminder buttons), Routine and live status (section + groups), Free rooms, Flags (list + "flag a problem" dialog).

## Acceptance tests

- CRD-DSH-01: after the admin removes the role, the next overview call → `404`.
- CRD-DSH-02: a CR of 2-II-A calling the overview of 2-II-B → `404`.
- CRD-DSH-03: roster entries have no phone or email keys.
- CRD-DSH-04: CR and DCR both reminding the same student on the same day → the second gets `429`.
- CRD-DSH-06: in a lab period for G1 only, G1 shows "In class" and G2 shows "Free".
- CRD-DSH-11: the 6th flag in a day → `FLAG_LIMIT`.
- CRD-DSH-12: a group change writes an audit entry with old and new group.

## Decisions and open questions

- **Decision:** the "unconfirmed students" list for a CR includes last semester's matching section plus anyone who applied here (CRD-DSH-04). The PRD says "students who have not done the semester update" without saying which students belong to a section before they are accepted.
- **Decision:** the reminder limit is shared across the section's CR/DCRs (one per student per day in total).

## Tasks

- [ ] Access guard (role in effect, per request)
- [ ] Overview service (roster, unconfirmed, flags)
- [ ] Section/group routine + status data
- [ ] Reminders with daily limit
- [ ] `flag` model + raise endpoint + limit
- [ ] Dashboard page
- [ ] Tests
