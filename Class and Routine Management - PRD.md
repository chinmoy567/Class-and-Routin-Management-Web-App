# Class & Routine Management — PRD

Oct 10, 2026 · @chinmoy

A web platform where teachers and students sign in, keep rich profiles, message and form groups like WhatsApp, and read their level–term–section class routines; an admin approves CR/DCR applications and publishes routines, and any student or CR can book a free classroom if they request at least 12 hours ahead.

## Overview & goals

The product is one web app serving a single institution's teachers and students. It replaces scattered WhatsApp groups and printed routine sheets with one place to log in, keep a profile, message, read the class routine, and book free classrooms.

What it commits to:

1. Give every teacher and student a single sign-in and an editable profile (level, term, section, phone, photo, CR/DCR status).
2. Let students and teachers message one-to-one and in groups, like WhatsApp.
3. Let an admin approve CR/DCR applications and publish routines that each student sees filtered to their own level, term and section.
4. Show which classroom is free at which time, and let a student or CR book a free room if the request is placed at least 12 hours ahead.

Out of scope for the first version: attendance, grades/marks, fee payment, and parent accounts. These are noted so the data model leaves room for them later.

## Users & roles

There are three account types. CR and DCR are not separate account types — they are students with an approved extra role, so everything a student can do, a CR or DCR can do too, plus the room-request power.

| Role | Signs in with | Can do | Cannot do |
| --- | --- | --- | --- |
| Admin | Own user ID + password (seeded, not self-registered) | Approve/reject CR & DCR applications, publish and edit routines, manage classrooms, see everyone | Be self-created from the sign-up page |
| Teacher | Email + password | Edit own profile, message & create groups, view routines, see which rooms are free | Approve CR/DCR, publish routines |
| Student | Unique UV ID + password | Edit own profile, message & create groups, view own level–term–section routine, apply to be CR/DCR | Publish routines, approve others |
| CR (approved student) | Same as student | Everything a student can, plus **request a free classroom** | Approve others, publish routines |
| DCR (approved student) | Same as student | Same as CR | Same as CR |

Notes:

- A section has one CR and up to two DCRs (your "2 DCR" rule). The system should block a third DCR approval for the same section and tell the admin why.
- The UV ID is the student's institutional ID, issued offline and unique. Students do not pick it; they use it to claim their account.
- Admin is seeded by whoever installs the system; there is no public admin sign-up.

## Authentication & onboarding

Each role claims its account differently, but all land in the same profile editor afterward.

- **Teacher** signs up with email + password, verifies the email, and is in. Email is their login from the start.
- **Student** signs up with their unique UV ID + a password they set. They have no email at sign-up. Later, in their profile, they can add an email (and use it for password recovery).
- **Admin** does not sign up. Credentials are seeded at install; admin just logs in with the user ID and password.

First-login flow for a new student or teacher: claim account → forced to complete profile (level, term, section, phone, photo optional) → land on the dashboard.

Password rules and recovery:

- Passwords are stored hashed (never plain text). Minimum length and complexity to be set in the open questions.
- Teacher recovery is by email link. Student recovery works only after they have added an email; before that, recovery goes through the admin resetting it. This gap should be called out to students when they skip adding an email.
- Sessions should expire after a period of inactivity and on password change.

## Core features

Each feature below is a requirement. Priority: P0 = first release, P1 = soon after.

| # | Feature | What it does | Who | Priority |
| --- | --- | --- | --- | --- |
| F1 | Profile editor | Edit level, term, section, phone, profile picture; add/change email; view CR/DCR status | Teacher, Student | P0 |
| F2 | Direct messaging | One-to-one chat with read receipts and timestamps, like WhatsApp | Teacher, Student | P0 |
| F3 | Group chat | Create a group, add members, send messages; creator is group admin | Teacher, Student | P0 |
| F4 | CR/DCR application | A student applies for a CR or DCR role for their section | Student | P0 |
| F5 | Approval dashboard | Admin sees pending CR/DCR applications and approves or rejects | Admin | P0 |
| F6 | Routine publishing | Admin builds and publishes routines per level–term–section | Admin | P0 |
| F7 | Routine viewing | A student sees only their section's routine; a teacher sees their own classes | Teacher, Student | P0 |
| F8 | Free-room view | See which classroom is free at which time slot | Everyone | P0 |
| F9 | Room booking request | Request a free room, only if ≥ 12 hours ahead of the slot | CR, DCR, Student | P0 |
| F10 | Media in messages | Send images/files in chats | Teacher, Student | P1 |
| F11 | Notifications | Alert on new message, approval result, booking result, routine change | Everyone | P1 |

F9's requester scope needs a decision — your brief says both "CR/DCR can request" and "the student can request"; the table assumes any student may request and CR/DCR is not required. This is flagged in Open questions.

## CR/DCR approval workflow

![CR/DCR approval flow · 4 steps, 1 decision — diagram in the live doc]

A student's application sits in a pending queue until the admin acts. The admin approves only if the section's CR/DCR cap is not already full; otherwise it is rejected with a reason.

Flow: Student applies → Pending queue → Admin reviews (cap ok?) → if approve: Role granted; if reject or cap full: Rejected.

## Classroom booking rules

![Classroom booking flow · 2 checks — diagram in the live doc]

A room can be requested only for a slot where no routine and no existing booking uses it. The request must also be placed at least 12 hours before the slot starts — a request for a slot sooner than that is blocked. Both checks must pass; failing either stops the booking and tells the requester why.

Flow: Request a room → Room free? → if no: Shown as taken; if yes → 12h ahead? → if no: Too late, blocked; if yes: Booked.

The assumptions behind this flow (who may request, whether it auto-confirms) are listed in Open questions.

## Routine management

The admin owns the routine; everyone else reads it. A routine is a weekly grid of time slots mapped to a subject, a teacher and a classroom, scoped to one level–term–section.

How it works:

1. Admin creates a routine for a level, term and section — for example, Level 2, Term 1, Section A.
2. For each slot (day × time), admin assigns subject, teacher and room.
3. Admin publishes it. Publishing is what makes it visible to students and teachers.
4. A student opens "My routine" and sees only the routine for their own level, term and section — no manual filtering.
5. A teacher sees a view assembled from every slot where they are the assigned teacher, across sections.

Your brief mentions the routine being "given every six months." That maps to term-based routines: each term (roughly six months) the admin publishes a new routine, and the old one is archived, not deleted, so history stays. Whether a term is exactly six months, or set by an academic calendar, is an open question.

The routine is also the source of truth for free rooms (next section): a room is free in a slot when no published routine, and no approved booking, uses it.

## Non-functional requirements

- **Security.** Passwords hashed with a modern algorithm (bcrypt/argon2). All traffic over HTTPS. Role checks enforced on the server, not just hidden in the UI — a student cannot reach admin actions by guessing a URL.
- **Privacy.** Phone numbers and email are visible per the profile owner's choice; default to visible only to the institution, not public. Email is used only to identify the user and for recovery, never shared externally.
- **Authorization.** Every routine-edit, approval and booking action is checked against the caller's role and scope (a CR can request rooms, only the admin approves CR/DCR).
- **Performance.** Routine and free-room views should load in under ~2 seconds for a section. Messaging should feel real-time (delivery within ~1–2 seconds).
- **Platform.** Responsive web app, works on phone and desktop browsers. No native app required for the first release.
- **Availability & data.** Daily backups; archived routines and chat history retained. Account lockout after repeated failed logins.
- **Auditability.** Admin approvals, rejections and routine publishes are logged with who and when.

## Open questions

These need your decision before build:

1. **Who can request a room?** Your brief says both CR/DCR and any student. Current assumption: any logged-in student may request; CR/DCR is not required. Confirm or restrict to CR/DCR.
2. **What does "12 hours ahead" block exactly?** Assumption: the request must be submitted at least 12 hours before the slot's start time, otherwise it is rejected. Confirm.
3. **Does a room booking need approval?** Assumption: if the room is free and the 12-hour rule is met, the booking is auto-confirmed (no admin step). Or should admin/CR approve it?
4. **Is a term exactly six months?** Or driven by an academic calendar with set start/end dates?
5. **One CR + two DCRs per section** — confirm these caps, and whether a teacher or admin nominates them or students self-apply.
6. **Password policy** — minimum length, complexity, lockout threshold.
7. **Media limits** — max file size and allowed types in messages.
8. **Institution scope** — one institution per deployment, or should it support multiple?
