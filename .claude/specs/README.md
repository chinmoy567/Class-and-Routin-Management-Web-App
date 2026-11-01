# Specs

This project is built **spec-first**. The PRD (`DOCUMENTS/Class and Routine Management - PRD.md`) says *what* the product does. The specs here split it into pieces that can each be built, tested and finished on their own, and add the details the PRD leaves open: data, API, permissions, error codes and tasks.

## How to use the specs

1. **One spec at a time, in the build order below.** Don't start a spec until the specs it depends on are done.
2. **Read the spec first, then its PRD sections.** The spec lists them. If the spec and the PRD disagree, the PRD wins, unless the spec marks the point as a **Decision**. Fix the spec, then build.
3. **Requirements have IDs** (`AUTH-07`). Tests are named after them (`it('AUTH-07 …')`), so every requirement can be traced to a test.
4. **Status** at the top of each spec: `Draft` → `Approved` (you agreed to it) → `In progress` → `Done` (every task ticked, every requirement has a passing test).
5. **Changing scope:** edit the spec first, then the code. Never let the code drift away from the spec.
6. **Decisions and open questions:** each spec ends with the points the PRD doesn't settle. **Decision** = the spec chose an answer you can override. **Open** = must be answered before that part is built.

Use `/build-feature specs/NN-name.md` to build a spec.

## Build order

### R1: launch (target: Spring 2027 rollover, 4 Apr 2027)

| # | Spec | Depends on |
|---|---|---|
| 00 | [Foundation](00-foundation.md): repo, server and client skeleton, shared libs, `can()`, audit, jobs, mail, tests | none |
| 01 | [Auth and accounts](01-auth-accounts.md): sign-up, verification, sign-in, second step, sessions, recovery | 00 |
| 02 | [Profile](02-profile.md): phone, photo, email change, the profile page | 01 |
| 03 | [Departments and admins](03-departments-admins.md): departments, admin roles, recovery | 01 |
| 04 | [Semesters](04-semesters.md): draft, current, archived, dates | 03 |
| 05 | [Classrooms](05-classrooms.md): rooms, aliases, sharing departments | 03 |
| 06 | [Teachers](06-teachers.md): registration approval, short-code linking, suspend and remove | 03 |
| 07 | [Routine import](07-routine-import.md): template, checks, preview, re-import diff, publish | 04, 05, 06 |
| 08 | [Routine edit](08-routine-edit.md): slot add, edit and delete with checks | 07 |
| 09 | [CR/DCR assignment](09-cr-dcr-assignment.md) | 04, 07 |
| 10 | [Join requests and ID claims](10-join-requests.md): enrolment, UV ID claim, groups, escalation | 09 |
| 11 | [University calendar](11-calendar.md): events, single-class cancellation | 04, 07 |
| 12 | [My routine and live status](12-my-routine-live-status.md) | 10, 11 |
| 13 | [Free-room view](13-free-room-view.md): read-only | 05, 07, 11 |
| 14 | [Semester rollover](14-semester-rollover.md): readiness, make current, update screen | 09, 10 |
| 15 | [Transactional email](15-transactional-email.md): catalogue, batching, bounces, digests | 00, built alongside 01 onwards |
| 16 | [Student and teacher dashboards](16-student-teacher-dashboards.md) | 12, 13 |
| 17 | [CR/DCR dashboard](17-cr-dcr-dashboard.md): roster, reminders, flags | 10, 12 |
| 18 | [Admin dashboard](18-admin-dashboard.md): cards, user management, audit log view | 03–17 |

### R2

| # | Spec | Depends on |
|---|---|---|
| 19 | [Room booking](19-room-booking.md): requests, approval, expiry, cancel | 13, 18 |

### R3

| # | Spec | Depends on |
|---|---|---|
| 20 | [Chat](20-chat.md): one-to-one, section groups, real-time, unread | 10, 09 |
| 21 | [Chat files](21-chat-files.md) | 20 |
| 22 | [Chat safety and retention](22-chat-safety-retention.md) | 20 |

### Across releases

| # | Spec |
|---|---|
| 23 | [Operations](23-operations.md): Docker Compose, replica set, backups, CI, monitoring |

### Later (not specced yet)

These are only noted so the design leaves room for them: teacher and section announcements (F7d, F9b), in-app notification centre (F11), student status for teachers and the "free now" list (F14), student removal requests (F9c), Ramadan timetable. Write their specs when their release is planned.

## Conventions shared by all specs

- **API base path:** `/api`. The PRD's paths (`/auth/login`) become `/api/auth/login`.
- **Responses:** `{ data }` on success, `{ error: { code, message, fields? } }` on failure. The error codes are listed in [00-foundation](00-foundation.md#error-codes).
- **Field names** in collections follow the PRD data model (snake_case).
- **Time:** all rules are in `Asia/Dhaka`. Dates are `YYYY-MM-DD` strings, times of day are minutes since midnight, and instants are UTC `Date`s.
- **"Admin of D"** means a department admin of department D, or any super admin.
- **Every audited action** writes to `audit_log` inside the same transaction as the action.

## Spec template

Copy this for a new spec:

```markdown
# NN: Title

Release · Status: Draft · Depends on: … · PRD: <sections> · Diagrams: <files>

## Goal
## Scope (and Out of scope)
## Requirements           (PREFIX-01 … one testable rule each)
## Permissions            (who × account state)
## Data                   (collections, fields, indexes)
## API                    (method, path, who, input, success, error codes)
## Jobs and events
## Screens
## Acceptance tests       (Given / When / Then; [PRD] marks criteria copied from the PRD)
## Decisions and open questions
## Tasks
```
