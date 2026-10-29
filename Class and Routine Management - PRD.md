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
5. Show each student, live, whether they are in class or free right now according to their routine, with a countdown to the next change, and give teachers a "free now" list of students.

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

First-login flow for a new student or teacher: claim account → forced to complete profile (level, term, section, phone, photo optional) → the app assigns the lab group automatically from the UV ID → land on the dashboard.

At the start of every new semester, a returning student goes through the same forced step again for their level, term and section; the lab group is recalculated from their UV ID (see Semesters and student updates and Lab groups and ID ranges).

Password rules and recovery:

- Passwords are stored hashed (never plain text). Minimum length and complexity to be set in the open questions.
- Teacher recovery is by email link. Student recovery works only after they have added an email; before that, recovery goes through the admin resetting it. This gap should be called out to students when they skip adding an email.
- Sessions should expire after a period of inactivity and on password change.

## Core features

Each feature below is a requirement. Priority: P0 = first release, P1 = soon after.

| # | Feature | What it does | Who | Priority |
| --- | --- | --- | --- | --- |
| F1 | Profile editor | Edit level, term, section, phone, profile picture; add/change email; view CR/DCR status and the automatically assigned lab group (read-only) | Teacher, Student | P0 |
| F1a | Semester update | At the start of each semester (for example Spring 2026, then Fall 2026) the student must confirm or change their level, term and section before using the app; the lab group is recalculated from their UV ID | Student | P0 |
| F1b | Automatic lab group | The app works out a student's lab group (G1, G2, G3, …) from their UV ID using the ID ranges the admin keeps for each section; students cannot choose or edit it | System, Admin | P0 |
| F2 | Direct messaging | One-to-one chat with read receipts and timestamps, like WhatsApp | Teacher, Student | P0 |
| F3 | Group chat | Create a group, add members, send messages; creator is group admin | Teacher, Student | P0 |
| F4 | CR/DCR application | A student applies for a CR or DCR role for their section | Student | P0 |
| F5 | Approval dashboard | Admin sees pending CR/DCR applications and approves or rejects | Admin | P0 |
| F6 | Routine publishing | Admin builds and publishes routines per level–term–section | Admin | P0 |
| F7 | Routine viewing ("My routine") | A student opens the app and automatically sees their own routine, picked from the level, term and section in their profile and the lab group worked out from their UV ID, with no manual searching or filtering; a teacher sees their own classes | Teacher, Student | P0 |
| F8 | Free-room view | See which classroom is free at which time slot | Everyone | P0 |
| F9 | Room booking request | Request a free room, only if ≥ 12 hours ahead of the slot | CR, DCR, Student | P0 |
| F10 | Media in messages | Send images/files in chats | Teacher, Student | P1 |
| F11 | Notifications | Alert on new message, approval result, booking result, routine change | Everyone | P1 |
| F12 | Live class status | Shows whether a student is **in class** or **free** right now, computed from their published routine; refreshes automatically every minute | Student (own), Teacher (any student) | P0 |
| F13 | Next-class countdown | While in class, counts down to the end of the class; while free, counts down to the start of the next class | Student, Teacher | P0 |
| F14 | "Free now" student list | Teacher sees every student currently free (and, optionally, who is in class), filterable by level, term, section and group | Teacher | P1 |

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
4. A student opens "My routine" and sees only the routine for their own level, term, section and lab group — no manual filtering. The app reads level, term and section from the student's profile (F1) and works out the group from their UV ID (F1b), so the right routine appears as soon as they log in.

### Routine file import

The Excel sheet is the source of truth for the whole routine: classes, teachers, rooms, and which UV ID range belongs to which group. The app does not invent or guess any of it.

1. Every semester, a teacher gives the department's new Excel sheet to the main admin. The sheet changes every semester, so last semester's data is never reused.
2. The main admin uploads it to the new semester. The system reads the weekly routine sheet and the "Level wise Student number" sheet (sections, groups and ID ranges).
3. Before publishing, the admin sees a preview and a list of problems found in the file (see the data-quality list in Open questions, for example inconsistent batch labels, overlapping ID ranges, or a short teacher code used by two people). The admin fixes the file or corrects the entries, then publishes.
4. Publishing is what makes the new routine and group assignments take effect: students' groups are recalculated from their UV IDs against the new ranges.
5. If the teacher later sends a corrected sheet, the admin re-imports it for the same semester and the changes replace the draft or published routine. This is logged with who and when, and affected students are notified (F11).
6. Only the main admin can import. Teachers and students never edit the routine or the group ranges directly.

### Lab groups and ID ranges

Theory classes are for the whole section, but sessional (lab) courses are split into groups so that each group fits a lab. For example, a 2-II batch has a Data Structures and Algorithms sessional that is split into G1, G2 and G3. Each group has its own teacher (or pair of teachers), day, time and lab room: G1 may be taken by one teacher on Sunday in one lab, G2 by a different teacher on Tuesday, and G3 by another teacher on Thursday. The course is the same, but the teacher, time and room are not. Two students in the same section can therefore have different routines, and see different teachers for the same course.

How a student's group is decided:

1. A student's routine is decided in this order: **level → term → section → group**.
2. The group comes from the student's **UV ID**, never from a choice the student makes. Each section has ID ranges, one per group, for example IDs 1–25 are G1, IDs 26–50 are G2, IDs 51–75 are G3 (as written in the "Level wise Student number" sheet of the routine file, for example `G1 = 1123001–1123025`).
3. The routine Excel sheet is the only source for these ranges. Each semester a teacher gives the department's new Excel sheet (for example "Dept of CSE Routine Spring 2026"), and the main admin imports it (see Routine file import). The ranges are never typed in by students or teachers.
4. When a student's profile is saved or a semester changes, the app finds the range containing their UV ID and stores that group on the profile as read-only.
5. A lab slot tagged with a group (such as `CSE-422 (G1)`) is shown only to students whose group matches, with that group's teacher, time and room. Slots for the whole section (no group tag) are shown to everyone in it.
6. Because every group has its own teacher, the routine stores teacher, time and room per group, never per course. A teacher's own routine (F7) is built from the group slots they are assigned to, so a teacher can appear in several groups of the same course, and a student sees only their own group's teacher.

Edge cases the system must handle:

- **UV ID outside every range** (for example repeat or transfer students listed as "+ REPEAT" in the sheet): the app does not guess; it flags the student for the admin to assign a group by hand, and until then shows only the whole-section classes with a notice.
- **Overlapping or missing ranges**: the admin screen rejects ranges that overlap inside a section or leave gaps without warning.
- **Admin override**: the admin can set a group manually for one student, and that override is kept and logged.
- **Group changes between semesters** are expected, since ranges differ by level and term.
5. A teacher sees a view assembled from every slot where they are the assigned teacher, across sections.

Your brief mentions the routine being "given every six months." That maps to term-based routines: each term (roughly six months) the admin publishes a new routine, and the old one is archived, not deleted, so history stays. Whether a term is exactly six months, or set by an academic calendar, is an open question.

### Semesters and student updates

Each six-month period is a named **semester**, for example Spring 2026 or Fall 2026. The admin creates the semester, publishes its routines, and marks it as the current one. A student's level, term and section are only valid for one semester, because students move up (for example from 2-I to 2-II) and may change section. The lab group is not chosen by the student; it is recalculated from their UV ID each semester.

How the rollover works:

1. When the admin makes a new semester current, every student's saved level, term and section are marked **unconfirmed** for it.
2. The next time a student logs in, they are shown the semester update screen and cannot use "My routine", live status, room booking or the rest of the app until they confirm. It is pre-filled with the suggested next term (for example 2-I becomes 2-II) and last semester's section, and asks "Which level and term are you in now? Which section?". The lab group is then shown as read-only, calculated from their UV ID.
3. The student confirms or changes the values and saves. Their profile is stamped with the semester it was confirmed for (for example "Fall 2026").
4. From then on, everything the student sees is based on those four values for the current semester: their routine, the live in-class or free status and countdown, the section's CR and DCR, and the free-room view.
5. Last semester's values and routine stay in the student's history and are never overwritten.

Rules:

- A student who is on a break and has not confirmed sees only the update screen and their profile; the app does not guess their section.
- Students who have not confirmed by a deadline set by the admin appear in an "unconfirmed students" list for the admin, so they can be followed up.
- A student's CR or DCR role belongs to a section and semester. It ends at rollover and must be re-applied for or re-approved (see Open questions).
- The student's profile always shows the semester it was last confirmed for, so a wrong or stale section is easy to spot.

The routine is also the source of truth for free rooms (next section): a room is free in a slot when no published routine, and no approved booking, uses it.

### My routine (student view)

- **Automatic:** the student never chooses a routine. Level, term and section come from their profile, the lab group is worked out from their UV ID, and the app shows the matching published routine.
- **Today first:** the page opens on today's classes, then offers the full week (Sunday to Thursday). Each class shows time, subject, teacher and room.
- **Group-aware:** a lab tagged for one group (for example G1) is shown only to that group. Classes for the whole section are shown to everyone in it.
- **Always current:** when the admin publishes a changed routine, the student sees the new one on their next visit with no action on their part. Archived routines from earlier terms are not shown here.
- **Missing profile data:** if a student has not set their level, term or section, the page asks them to complete their profile. If their group could not be worked out from their UV ID, the page shows the whole-section classes with a notice that the admin must assign a group, instead of showing a wrong routine.

## Live class status

The routine already says who has which class when, so the app can also answer "what is this student doing right now?" without any extra data entry.

How status is decided (F12):

1. Take the student's level, term and section from their profile and their lab group from their UV ID.
2. Take the current day and time in the institution's timezone.
3. Look in the student's published routine for a slot on that day whose start–end time contains the current time.
   - A match means **In class**. Show the subject, teacher, room and end time.
   - No match means **Free**. Show when the next class starts.
4. A class applies to a student if it is for their whole section, or for their lab group. Lab slots tagged with a group (for example G1 or G2) apply only to that group; the same section can be in a lab and free at the same time.
5. On non-teaching days (the routine runs Sunday to Thursday) the status shows "No classes today" rather than "Free", and the countdown points to the next teaching day's first class.

Countdown (F13):

- **In class:** "Class ends in 25 min".
- **Free:** "Next class CSE-421 in 1 h 10 min, Room 311". If there are no more classes today, it counts down to the first class of the next teaching day.
- The status and countdown refresh on their own every minute while the page is open. No manual reload is needed.

"Free now" list for teachers (F14):

- A teacher opens a list of students who are free at this moment, with the time each one's next class starts, so the teacher can see who is available, for example for a makeup class or a meeting.
- The list can be filtered by level, term, section and group, and switched to show who is in class.
- Because status comes from the section and group routine, every student in the same section and group shows the same status. An individual student's status is only as accurate as the section saved in their profile and the ID ranges the admin keeps.
- Teachers see only what the routine implies (in class or free), never a student's location, messages or attendance.

## Non-functional requirements

- **Security.** Passwords hashed with a modern algorithm (bcrypt/argon2). All traffic over HTTPS. Role checks enforced on the server, not just hidden in the UI — a student cannot reach admin actions by guessing a URL.
- **Privacy.** Phone numbers and email are visible per the profile owner's choice; default to visible only to the institution, not public. Email is used only to identify the user and for recovery, never shared externally.
- **Authorization.** Every routine-edit, approval and booking action is checked against the caller's role and scope (a CR can request rooms, only the admin approves CR/DCR).
- **Performance.** Routine and free-room views should load in under ~2 seconds for a section. Messaging should feel real-time (delivery within ~1–2 seconds). The live status and countdown are computed from the already-loaded routine, so the minute refresh needs no extra server call; the teacher "free now" list loads in under ~2 seconds for all sections.
- **Platform.** Responsive web app, works on phone and desktop browsers. No native app required for the first release.
- **Availability & data.** Daily backups; archived routines and chat history retained. Account lockout after repeated failed logins.
- **Auditability.** Admin approvals, rejections and routine publishes are logged with who and when.

## Open questions

These need your decision before build:

1. **Who can request a room?** Your brief says both CR/DCR and any student. Current assumption: any logged-in student may request; CR/DCR is not required. Confirm or restrict to CR/DCR.
2. **What does "12 hours ahead" block exactly?** Assumption: the request must be submitted at least 12 hours before the slot's start time, otherwise it is rejected. Confirm.
3. **Does a room booking need approval?** Assumption: if the room is free and the 12-hour rule is met, the booking is auto-confirmed (no admin step). Or should admin/CR approve it?
4. **Is a term exactly six months?** Or driven by an academic calendar with set start/end dates?
4a. **Semester rollover.** Should the app move students up one term automatically for them to confirm (for example 2-I to 2-II), or should the student pick everything from scratch? Current assumption: it pre-fills the next term and the student confirms. Also: do CR and DCR roles reset every semester, and what is the deadline for confirming?
5. **One CR + two DCRs per section** — confirm these caps, and whether a teacher or admin nominates them or students self-apply.
6. **Password policy** — minimum length, complexity, lockout threshold.
7. **Media limits** — max file size and allowed types in messages.
8. **Institution scope** — one institution per deployment, or should it support multiple?
9. **Group ID ranges.** Decided: the lab group is worked out from the UV ID, not chosen by the student. The ID ranges come only from the Excel sheet that the main admin imports each semester (see Routine file import). Still to confirm: how repeat students and IDs outside every range should get a group, and whether the sheet layout will stay the same every semester (the importer depends on it).
10. **Holidays and cancelled classes.** Should the admin be able to mark a date as a holiday or cancel a single class, so status shows "No class today" instead of "In class"? The first version assumes the routine always runs.
11. **Timezone.** Assumption: all status is computed in one institution timezone, not the viewer's device clock.
12. **Teacher visibility of status.** Should a student be able to hide their in-class/free status from the teacher "free now" list, or is it always visible to teachers?
13. **Routine file quality.** The current spreadsheet has inconsistent batch labels (for example `3-1-A` vs `3-I-A`, and `4-I` stored as a date), a duplicated `CSE-301 (G1)` slot in the Tuesday 3-II-A row, and one short code (`AR`) used by two teachers. These should be cleaned up before import.
