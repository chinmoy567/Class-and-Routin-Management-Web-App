# Class & Routine Management — PRD

Oct 10, 2026 · @chinmoy

A web platform where teachers and students sign in, keep rich profiles, message and form groups like WhatsApp, and read their level–term–section class routines; an admin approves teachers, chooses each section's CR and DCR, and publishes routines; the CR and DCR approve their section's students; and any student or CR can book a free classroom if they request at least 12 hours ahead.

## Overview & goals

The product is one web app serving a single institution's teachers and students. It replaces scattered WhatsApp groups and printed routine sheets with one place to log in, keep a profile, message, read the class routine, and book free classrooms.

What it commits to:

1. Give every teacher and student a single sign-in and an editable profile (level, term, section, phone, photo, CR/DCR status).
2. Let students and teachers message one-to-one and in groups, like WhatsApp.
3. Let an admin approve teachers, choose each section's CR and DCR, and publish routines that each student sees filtered to their own level, term, section and lab group.
4. Show which classroom is free at which time, and let a student or CR book a free room if the request is placed at least 12 hours ahead.
5. Show each student, live, whether they are in class or free right now according to their routine, with a countdown to the next change, and give teachers a "free now" list of students.

Out of scope for the first version: attendance, grades/marks, fee payment, and parent accounts. These are noted so the data model leaves room for them later.

## Users & roles

There are three account types. CR and DCR are not separate account types — they are students given an extra role by the admin, so everything a student can do, a CR or DCR can do too, plus the dashboard for their own section (including approving their classmates' UV ID claims).

| Role | Signs in with | Can do | Cannot do |
| --- | --- | --- | --- |
| Admin | Own user ID + password (seeded, not self-registered) | Approve/reject teacher registrations, choose and remove each section's CR and DCR, approve ID claims that no CR/DCR can handle, publish and edit routines, manage classrooms, see everyone | Be self-created from the sign-up page |
| Teacher (after admin approval) | Email + password | Edit own profile, message & create groups, view own teaching routine, see which rooms are free, request a free room (12-hour rule), see the roster and "free now" list of sections they teach, send announcements to those sections | Approve CR/DCR, publish routines, see students of sections they do not teach, use the app before the admin approves the account |
| Student | Email + password (the UV ID is claimed after sign-up) | Edit own profile, claim their UV ID, and once the CR or DCR approves the claim: message & create groups, view own level–term–section–group routine | Publish routines, approve others, apply to be CR/DCR, use the app before the ID claim is approved |
| CR (student chosen by the admin) | Same as student | Everything a student can, plus **request a free classroom**, use the **CR/DCR dashboard** for their own section, and approve or reject UV ID claims from students of that section | Approve CR/DCR or teachers, approve their own claim, publish or edit routines, delete or deactivate accounts, see other sections' students |
| DCR (student chosen by the admin) | Same as student | Same as CR | Same as CR |

Notes:

- A section has one CR and up to two DCRs (your "2 DCR" rule). The system should block a second CR or a third DCR for the same section and tell the admin why.
- The UV ID is the student's institutional ID, issued offline and unique. Students do not pick it; they enter it after signing up to claim it, and the CR or DCR of their section approves the claim (see Student ID claim).
- Admin is seeded by whoever installs the system; there is no public admin sign-up.

## Authentication & onboarding

Each role claims its account differently, but all land in the same profile editor afterward.

- **Teacher** signs up with email + password and verifies the email. Email is their login from the start. The account then stays **pending** until the admin approves it (see Teacher approval); a pending teacher can sign in only to see a "waiting for admin approval" screen.
- **Student** signs up with an **email + password** and verifies the email, like a teacher. After that they claim their unique UV ID in their profile (see Student ID claim). The email is used to sign in, for password recovery, and for the automatic messages the system sends to students.
- **Admin** does not sign up. Credentials are seeded at install; admin just logs in with the user ID and password.

First-login flow for a new teacher: sign up and verify email → wait for admin approval → complete profile → land on the dashboard.

First-login flow for a new student: sign up and verify email → complete profile (level, term, section, phone, photo optional) and enter the UV ID → wait for the CR or DCR of that section to approve the claim → the app assigns the lab group automatically from the UV ID → land on the dashboard.

At the start of every new semester, a returning student goes through the same forced step again for their level, term and section; the lab group is recalculated from their UV ID (see Semesters and student updates and Lab groups and ID ranges).

Password rules and recovery:

- Passwords are stored hashed (never plain text). Minimum length and complexity to be set in the open questions.
- Teacher and student recovery are both by email link. Because a student's email is required, every student can recover their own password. Admin reset remains only as a fallback for a student whose email address no longer works.

Required student email:

- A student cannot sign in until they verify their email by clicking a link sent to that address.
- Each email can belong to only one student account.
- A student can change their email later, but the new address must be verified before it replaces the old one. If an email stops working (bounces), the student is asked to update it at next login.
- The email is used to send the student automatic messages from the system. The list of what is sent (for example routine changes, approval results, booking results) is still to be decided and is tracked in Open questions.
- Sessions should expire after a period of inactivity and on password change.

### Student ID claim

A student's email only proves they own an inbox. The UV ID proves who they are at the university. Because UV IDs are sequential and easy to guess, a student does not become a student by typing an ID; the CR or DCR of their section has to approve it. The CR and DCR know their classmates, so they do not need a student list.

1. After verifying their email, the student fills in level, term and section in their profile and enters the UV ID the university gave them.
2. Automatic checks run first. The claim is blocked, with a reason, if: the ID format is invalid; the ID is outside every ID range of the chosen section in the imported routine file (this catches typos and claims for the wrong section or term); or the ID is already claimed by another account (the admin is told).
3. If the checks pass, the claim goes to the CR and DCRs of that section as a **pending ID claim**. Until it is approved the student sees a "waiting for approval" screen. They can edit their profile but cannot see the routine, rooms or chats.
4. The CR or DCR sees the student's name, email, photo, level, term, section and UV ID, and approves or rejects (a reason is required for a rejection). Whoever acts first decides, and the student is told by email.
5. On approval the account becomes active and the lab group is set from the UV ID.

Rules:

- A CR or DCR cannot approve their own claim or another CR/DCR's claim. Those go to the admin.
- A section with no CR or DCR yet is handled by the admin until one is chosen.
- If nobody acts on a claim within a set time, it moves to the admin (the time is an open question).
- A student whose ID is outside every range (for example a repeat student) is sent to the admin, who assigns a section and group by hand.
- If someone else claimed a student's ID, the real student reports it. The admin checks in person, can revoke the wrong claim, and the action is logged.
- A student has a limited number of wrong claims before they are blocked for a while.
- Every claim, approval, rejection and revocation is logged with who and when.

## Core features

Each feature below is a requirement. Priority: P0 = first release, P1 = soon after.

| # | Feature | What it does | Who | Priority |
| --- | --- | --- | --- | --- |
| F1 | Profile editor | Edit level, term, section, phone, profile picture; **required, verified email** (add and change); view CR/DCR status and the automatically assigned lab group (read-only) | Teacher, Student | P0 |
| F1a | Semester update | At the start of each semester (for example Spring 2026, then Fall 2026) the student must confirm or change their level, term and section before using the app; the lab group is recalculated from their UV ID | Student | P0 |
| F1b | Automatic lab group | The app works out a student's lab group (G1, G2, G3, …) from their UV ID using the ID ranges the admin keeps for each section; students cannot choose or edit it | System, Admin | P0 |
| F2 | Direct messaging | One-to-one chat with read receipts and timestamps, like WhatsApp | Teacher, Student | P0 |
| F3 | Group chat | Create a group, add members, send messages; creator is group admin | Teacher, Student | P0 |
| F4 | CR/DCR assignment | The admin chooses each section's CR and DCRs by hand (one CR, up to two DCRs); students do not apply | Admin | P0 |
| F4a | Teacher registration approval | A new teacher account is held as pending until the admin approves or rejects it | Teacher, Admin | P0 |
| F4b | Student ID claim approval | A student claims their UV ID after signing up; the CR or DCR of their section approves or rejects the claim | Student, CR, DCR | P0 |
| F5 | Approval dashboard | Admin sees pending teacher registrations and ID claims that need the admin, and manages CR/DCR assignments | Admin | P0 |
| F6 | Routine publishing | Admin builds and publishes routines per level–term–section | Admin | P0 |
| F7 | Routine viewing ("My routine") | A student opens the app and automatically sees their own routine, picked from the level, term and section in their profile and the lab group worked out from their UV ID, with no manual searching or filtering; a teacher sees their own classes | Teacher, Student | P0 |
| F7a | Full week routine on the dashboard | The student's dashboard shows their whole week (Sunday to Thursday) as a weekly grid, with today highlighted and the class happening now marked | Student | P0 |
| F7b | Student dashboard | One home page for a student showing live status and countdown, today's classes, the full week, announcements, notifications, rooms, messages and profile reminders | Student | P0 |
| F7c | Teacher dashboard | One home page for a teacher showing teaching status and countdown, today's classes, the week, free students, rooms, messages and notices | Teacher | P0 |
| F7d | Teacher announcements | A teacher sends a message to a section or lab group they teach | Teacher | P1 |
| F8 | Free-room view | See which classroom is free at which time slot | Everyone | P0 |
| F9 | Room booking request | Request a free room, only if ≥ 12 hours ahead of the slot | CR, DCR, Student, Teacher | P0 |
| F9a | CR/DCR dashboard | A section-only dashboard for CR and DCR to monitor their section (roster, unconfirmed students, routine, live status, bookings) and act (book and cancel rooms, announce, approve student ID claims, flag problems) | CR, DCR | P0 |
| F9b | Section announcements | CR/DCR sends a message to the whole section or to one lab group | CR, DCR | P1 |
| F9c | Student removal request | CR/DCR asks the admin to deactivate a student; only the admin acts on it | CR, DCR, Admin | P1 |
| F10 | Media in messages | Send images/files in chats | Teacher, Student | P1 |
| F11 | Notifications | Alert on new message, approval result, booking result, routine change | Everyone | P1 |
| F12 | Live class status | Shows whether a student is **in class** or **free** right now, computed from their published routine; refreshes automatically every minute | Student (own), Teacher (any student) | P0 |
| F13 | Next-class countdown | While in class, counts down to the end of the class; while free, counts down to the start of the next class | Student, Teacher | P0 |
| F14 | "Free now" student list | Teacher sees every student currently free (and, optionally, who is in class), filterable by level, term, section and group | Teacher | P1 |

F9's requester scope needs a decision — your brief says both "CR/DCR can request" and "the student can request"; the table assumes any student may request and CR/DCR is not required. This is flagged in Open questions.

## Student dashboard

The dashboard is the first page a student sees after login. Everything on it is based on the student's level, term, section and lab group for the current semester, and a student who has not confirmed the semester update (F1a) sees the update screen instead. The page is a summary: each card links to the full feature.

**1. Right now (top of the page)**

- **Live status:** "In class" or "Free", from the routine (F12). On Friday and Saturday it says "No classes today".
- **Countdown:** time left in the current class, or time until the next one (F13), refreshed every minute.
- **Current or next class card:** course, teacher for the student's group, room and time.

**2. Routine**

- **Today's classes** in time order, with the current one marked.
- **Full week grid** from Sunday to Thursday (F7a), with today highlighted.
- **Tomorrow preview:** the first class tomorrow and its start time, so the student knows when they must arrive.

**3. Notices**

- **Announcements** from the CR/DCR or admin for the student's section or lab group (F9b), newest first.
- **Notifications** for routine changes, approval results and booking results (F11), with an unread count.
- **Unread messages** count for direct chats and groups (F2, F3), linking to the chat.

**4. Rooms**

- **Free rooms now** from the free-room view (F8).
- **My room requests** and whether each is confirmed, rejected or cancelled (F9), with a button to request a new one.

**5. My section**

- **CR and DCRs** of the student's section, with a button to message them.
- **Courses this semester** with the teacher of the student's group for each course, taken from the routine, so group-specific teachers are shown correctly.
- **ID claim status** while the claim is pending or rejected, and a link to the CR/DCR dashboard if the student holds the role.

**6. Profile reminders**

- **Level, term, section and lab group** shown read-only (the group comes from the UV ID).
- **Semester badge** such as "Fall 2026 confirmed", with a warning when the update is overdue.
- **Email status:** a banner if the student's email is missing or unverified.
- **Group problem notice** if the admin must still assign a group (see Lab groups and ID ranges).

Rules:

- Cards only show data the student is allowed to see. A student never sees another section's routine, bookings or students.
- The dashboard works on a phone first: cards stack in one column, and the week grid becomes a day-by-day list (see F7a).
- A card with nothing to show is hidden or shows a short empty message, never a blank box.
- Priority order on a small screen: status and countdown, today's classes, notices, rooms, section, profile reminders.
- The dashboard loads in under ~2 seconds and the status and countdown refresh on their own without reloading the page.

## Teacher dashboard

The dashboard is the first page an approved teacher sees after login (a pending teacher sees only the waiting screen; see Teacher approval). Everything on it is based on the classes assigned to the teacher's linked short code in the current semester's routine. Each card links to the full feature.

**1. Right now (top of the page)**

- **My status:** "Teaching" or "Free", from the classes assigned to the teacher (same rule as F12, applied to the teacher instead of a student). On Friday and Saturday it says "No classes today".
- **Countdown:** time left in the current class, or time until the next one (F13), refreshed every minute.
- **Current or next class card:** course, section, lab group, room and time. For a lab shared with another teacher, the other teacher's short code is shown too.

**2. My routine (F7)**

- **Today's classes** in time order, across all sections, with the current one marked.
- **Full week grid** from Sunday to Thursday. A teacher teaches several sections and several lab groups of the same course, so each cell shows the course, section, group and room.
- **Next teaching day preview** when there are no more classes today.

**3. Students**

- **"Free now" list (F14):** students currently free, filterable by level, term, section and group. For a teacher it covers only the sections they teach.
- **Section roster:** for each section the teacher teaches, the students with name, UV ID and lab group. A teacher cannot open the roster of a section they do not teach.

**4. Rooms (F8, F9)**

- **Free rooms now.**
- **My room requests** and whether each is confirmed, rejected or cancelled, with a button to request a room. Teachers follow the same rules as students: the room must be free and the request made at least 12 hours before the slot.

**5. Messages and notices**

- **Unread messages and groups** count (F2, F3), linking to the chat.
- **Notifications** for routine changes and approval results (F11), with an unread count.
- **Announcements:** the teacher can send an announcement to a section or lab group they teach (F7d). It is emailed to those students and logged with the sender and time. Announcements from the admin appear here too.

**6. Account**

- **Linked short code and name** from the routine sheet. If the account is not yet linked, a notice asks the admin to link it.
- **Profile reminders** when email, phone or photo is missing.

What teachers cannot do or see:

- A student's location, messages or attendance, and any section's roster outside the sections they teach.
- Another user's private chats.
- Admin controls: approvals, routine import and group ranges.

Rules:

- Cards only show data the teacher is allowed to see. Roster and announcement access is derived from the routine: a teacher qualifies for a section only if they are assigned to at least one of its slots this semester.
- Where two teachers share a short code (the current sheet has `AR` used twice), the account cannot be linked until the admin fixes the sheet, and the dashboard shows the unlinked notice.
- The dashboard works on a phone first: cards stack in one column and the week grid becomes a day-by-day list.
- A card with nothing to show is hidden or shows a short empty message.
- It loads in under ~2 seconds and the status and countdown refresh without reloading.

## CR/DCR dashboard

CR and DCR have the same dashboard. It is scoped to **one section and one semester** (for example 3-II-A, Fall 2026). They never see another section's students. The dashboard is the only place where a student has more power than other students, and it ends at semester rollover with the role itself.

**Monitor (read-only views)**

- **Section roster:** every student in the section with name, UV ID, lab group, profile photo, and whether their profile is confirmed for this semester. Phone and email are shown only if the student's privacy setting allows it.
- **Unconfirmed students:** students who have not done the semester update, with a button to send them a reminder (limited to one reminder per student per day).
- **Section routine:** the published routine for the section, today's classes first, and which classes are happening now.
- **Live status:** who in the section is in class or free right now, with the countdown (F12/F13).
- **Free rooms:** which rooms are free in which slots (F8).
- **Room bookings:** all of the section's booking requests and whether each is confirmed, rejected or cancelled, with the reason.
- **Flags:** the status of anything the CR or DCR reported to the admin (open, fixed, rejected).

**Act**

- **Request a free room** for the section under the 12-hour rule (F9), and **cancel** the section's own booking.
- **Send an announcement** to the whole section or to one lab group (F9b). Announcements are also emailed to those students (F11) and are logged with the sender.
- **Approve or reject UV ID claims** from students of their section (see Student ID claim). The CR and DCR use what they know about their classmates; no student list is needed. They cannot approve their own claim.
- **Flag a problem to the admin**, for example a student in the wrong section or group, a missing student, or a routine mistake. The admin sees the flag with who raised it and when.
- **Request removal of a student** (F9c). The request says who and why. It does not delete anything.

**What a CR or DCR cannot do**

- Delete or deactivate any account. Only the admin can, and every removal is logged with who and when, so a mistaken request can be reversed. Student history is kept.
- Approve CR/DCR or teachers.
- Publish or edit routines, or change group ID ranges.
- See students, bookings or flags of any other section.
- Change a student's profile, section or group. A change is made by the student, or by the admin after a flag.

**Rules**

- Both CR and DCR can act. If two of them act on the same request, the first action wins and the other sees that it is already done.
- Every action on the dashboard is logged with who and when, and the admin can see the log.
- If a CR or DCR loses the role (end of semester, removed by the admin), the dashboard disappears at once and anything they started stays with the admin.

## Teacher approval

Anyone can reach the teacher sign-up page, so a teacher account is not trusted until the admin checks it. Teachers are approved by the admin, not by other teachers or students.

1. A teacher signs up with email + password and verifies the email.
2. The account is created as **pending**. The teacher can sign in only to a "waiting for admin approval" screen; they cannot message, see student profiles or see routines.
3. The admin sees the request in the approval dashboard (F5) with the teacher's name, email, department and short code (for example `MYA`), and checks it against the department's teacher list in the routine file.
4. The admin approves or rejects (a reason is required for a rejection). The teacher is told the result by email.
5. On approval the account becomes active, and the admin links the account to the teacher's short code from the routine sheet so the teacher's own classes appear in "My routine" (F7).
6. Approval and rejection are logged with who and when.

Rules:

- Only the admin can approve teachers; there is no self-approval and no way to become admin through this flow.
- A rejected teacher can re-apply, but the admin sees the earlier rejection.
- The admin can later suspend or remove an approved teacher (for example when they leave the department).
- The same short code cannot be linked to two active accounts, and the shared `AR` code in the current sheet must be resolved before it can be linked.

## CR/DCR assignment

The admin chooses each section's CR and DCRs by hand. Students do not apply, because the admin knows who should lead each section.

1. The admin opens the section (for example 3-II-A, Fall 2026) and picks a student whose ID claim is already approved.
2. The admin sets the role: CR or DCR.
3. The system blocks a second CR, or a third DCR, in the same section and tells the admin why.
4. The student sees the role on their profile and gets the CR/DCR dashboard. The assignment is logged with who and when.

Rules:

- A role belongs to one section and one semester. It ends at rollover and the admin chooses again for the new semester.
- The admin can remove a role at any time.
- For a brand new section with no CR yet, the admin approves the first ID claims and then names the CR and DCRs.

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
4. When a student's ID claim is approved or a semester changes, the app finds the range containing their UV ID and stores that group on the profile as read-only.
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
- A student's CR or DCR role belongs to a section and semester. It ends at rollover and the admin chooses the CR and DCR again for the new semester.
- The student's profile always shows the semester it was last confirmed for, so a wrong or stale section is easy to spot.

The routine is also the source of truth for free rooms (next section): a room is free in a slot when no published routine, and no approved booking, uses it.

### My routine (student view)

- **Automatic:** the student never chooses a routine. Level, term and section come from their profile, the lab group is worked out from their UV ID, and the app shows the matching published routine.
- **Today first:** the page opens on today's classes, then offers the full week (Sunday to Thursday). Each class shows time, subject, teacher and room.
- **Full week on the dashboard (F7a):** the student's dashboard has a weekly routine, so they do not need to open another page to plan their week.
  - It is a grid with the days (Sunday to Thursday) as rows or columns and the time slots (8:30–9:25 up to 4:35–5:30) on the other axis, matching the layout of the department's Excel sheet.
  - Each filled cell shows the course code, the teacher for the student's own group, and the room. Empty cells are free periods.
  - A lab that runs for several periods is shown as one block across those periods, and classes with their own time (for example 12:00–3:00) are placed at that time.
  - Today's column or row is highlighted, and the class happening right now is marked, with the live status and countdown (F12/F13) shown above the grid.
  - It shows only the student's own section and group, so classes of other groups are never listed.
  - On a phone, the grid switches to a day-by-day list with swipe or tabs between days, because a nine-period grid does not fit a narrow screen.
  - The week shown is always the current semester's published routine, and it updates when the admin imports a changed sheet.
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
- **Privacy.** Phone numbers and email are visible per the profile owner's choice; default to visible only to the institution, not public. Email is used only to identify the user, for recovery, and for the system's own automatic messages to that user, never shared externally.
- **Authorization.** Every routine-edit, approval and booking action is checked against the caller's role and scope (a CR can request rooms and approve their own section's ID claims; only the admin chooses CR/DCR).
- **Performance.** Routine and free-room views should load in under ~2 seconds for a section. Messaging should feel real-time (delivery within ~1–2 seconds). The live status and countdown are computed from the already-loaded routine, so the minute refresh needs no extra server call; the teacher "free now" list loads in under ~2 seconds for all sections.
- **Platform.** Responsive web app, works on phone and desktop browsers. No native app required for the first release.
- **Availability & data.** Daily backups; archived routines and chat history retained. Account lockout after repeated failed logins.
- **Auditability.** Admin approvals, rejections, CR/DCR assignments, ID claim approvals and revocations, and routine publishes are logged with who and when.

## Open questions

These need your decision before build:

1. **Who can request a room?** Your brief says both CR/DCR and any student. Current assumption: any logged-in student may request, and approved teachers may request too (for example for a makeup class); CR/DCR is not required. Confirm or restrict.
2. **What does "12 hours ahead" block exactly?** Assumption: the request must be submitted at least 12 hours before the slot's start time, otherwise it is rejected. Confirm.
3. **Does a room booking need approval?** Assumption: if the room is free and the 12-hour rule is met, the booking is auto-confirmed (no admin step). Or should admin/CR approve it?
4. **Is a term exactly six months?** Or driven by an academic calendar with set start/end dates?
4a. **Semester rollover.** Should the app move students up one term automatically for them to confirm (for example 2-I to 2-II), or should the student pick everything from scratch? Current assumption: it pre-fills the next term and the student confirms. Also: what is the deadline for confirming? (CR and DCR roles reset every semester and the admin chooses them again.)
5. **One CR + two DCRs per section.** Decided: the admin chooses them by hand and students do not apply. Still to confirm: the caps (one CR, up to two DCRs).
6. **Password policy** — minimum length, complexity, lockout threshold.
7. **Media limits** — max file size and allowed types in messages.
8. **Institution scope** — one institution per deployment, or should it support multiple?
9. **Group ID ranges.** Decided: the lab group is worked out from the UV ID, not chosen by the student. The ID ranges come only from the Excel sheet that the main admin imports each semester (see Routine file import). Still to confirm: how repeat students and IDs outside every range should get a group, and whether the sheet layout will stay the same every semester (the importer depends on it).
10. **Holidays and cancelled classes.** Should the admin be able to mark a date as a holiday or cancel a single class, so status shows "No class today" instead of "In class"? The first version assumes the routine always runs.
11. **Timezone.** Assumption: all status is computed in one institution timezone, not the viewer's device clock.
12. **Teacher visibility of status.** Should a student be able to hide their in-class/free status from the teacher "free now" list, or is it always visible to teachers?
13. **Routine file quality.** The current spreadsheet has inconsistent batch labels (for example `3-1-A` vs `3-I-A`, and `4-I` stored as a date), a duplicated `CSE-301 (G1)` slot in the Tuesday 3-II-A row, and one short code (`AR`) used by two teachers. These should be cleaned up before import.
14. **Teacher approval details.** Decided: only the admin approves teachers. Still to confirm: should the admin check teachers against a list of allowed email domains or the routine's teacher list, and may a teacher use the app (for example to see routines) while pending? Current assumption: no access until approved.
15. **Automatic emails to students.** Which messages should be sent to a student's email automatically (for example routine published or changed, CR/DCR approval result, room booking result, new semester update reminder, unconfirmed-profile warning)? Also: should students be able to turn some of them off? Current assumption: every student must have a verified email, and the list above is sent by default.
16. **CR/DCR dashboard.** Decided: the CR/DCR approve every student's ID claim, and they can only request removal of a student, never delete. Still to confirm: how many removal and flag requests a CR can send per day, whether a student should be told when a removal is requested about them, and whether announcements need admin or teacher review first.
17. **Student dashboard extras.** Should the dashboard also show the academic calendar (exams and holidays, for example from `academic callender.pdf`) and class-cancelled or room-changed alerts? Both depend on the holiday and cancellation handling in open question 10, so they are left out of the first version.
18. **Teacher dashboard.** Decided: teachers see the roster and "free now" list of sections they teach, may request free rooms under the 12-hour rule, and may announce to those sections. Still to confirm: whether the "free now" list may be widened to all sections (for example to plan a makeup class; the current rule keeps it to sections they teach), whether students can mute teacher announcements, and whether a room booked by a teacher should override a student's request for the same slot (current assumption: first valid request wins).
19. **Student ID claim.** Decided: students sign up with email + password and then claim their UV ID; the CR or DCR of the section approves the claim without a student list; the admin chooses CR/DCR by hand. Still to confirm: how many days before an unanswered claim moves to the admin, how many wrong claims block a student, and whether a rejected student may try again with the same ID.
