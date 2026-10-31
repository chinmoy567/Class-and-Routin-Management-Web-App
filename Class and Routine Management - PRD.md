# Class & Routine Management — PRD

Oct 10, 2026 · @chinmoy

A web platform where teachers and students sign in, keep profiles, chat one-to-one and in a section group, share study files, and read their level–term–section class routines.

A super admin and per-department admins run the system. Each department admin approves teachers, chooses each section's CR and DCR, and publishes routines for their own department.

The CR and DCR approve their section's students.

CRs, DCRs and teachers can request a free classroom at least 12 hours ahead, which the room's own department admin approves or rejects.

## Glossary

- **UV ID:** the student's institutional ID, issued offline by the university and unique to one student.
- **Level and term:** a student's place in the degree, for example 2-II is Level 2, Term II. A student moves up one term each semester.
- **Semester:** a named six-month period such as Spring 2026 or Fall 2026. Routines, CR/DCR roles and confirmations are tied to a semester. "Term" always means the academic step (I or II), never the calendar period.
- **Section and group:** a section is department + level + term + section letter (for example CSE 2-II-A). A group (G1, G2, …) is a split of a section for sessional (lab) classes only.
- **Batch:** all students of one department, level and term, who share the same routine rows in the import sheet.
- **CR and DCR:** the class representative and deputy representatives of a section, chosen by the department admin each semester.
- **Request and booking:** a room is first **requested**. When the department admin approves it, it becomes a **booking** and the room shows as Booked.

## Overview & goals

The product is one web app serving a single institution's teachers and students. It replaces scattered WhatsApp groups and printed routine sheets with one place to log in, keep a profile, message, read the class routine, and request free classrooms.

What it commits to:

1. Give every teacher and student a single sign-in and an editable profile (level, term, section, phone, photo, CR/DCR status).
2. Let students and teachers chat one-to-one with anyone, join their section's group chat, and share study files (see Chat). It is deliberately small and does not try to replace WhatsApp.
3. Let each department's admin approve teachers, choose each section's CR and DCR, and publish routines that each student sees filtered to their own department, level, term, section and sessional group.
4. Show which classroom is free at which time, and let a CR, DCR or teacher request a free room for this week or next week, at least 12 hours ahead, for the room's own department admin to approve.
5. Show each student, live, whether they are in class or free right now according to their routine, with a countdown to the next change, and, in a later release, give teachers a "free now" list of the students in the sections they teach.

**How people and routines are identified.** Every student, section and routine is identified by five things: **department** (for example CSE), **level**, **term**, **section**, and, for sessional (lab) classes only, **group**. A section is department + level + term + section, for example "CSE 2-II-A", and its routine, its CR and its DCRs belong to that exact section. Wherever this document says "level, term and section" it means the department as well. Teachers belong to a department too, and a teacher is identified by department + short code.

Out of scope for the first version: attendance, grades/marks, fee payment, and parent accounts. These are noted so the data model leaves room for them later.

There are no elective courses to model: the university fixes every student's courses, and students cannot choose electives. A student's routine is fully decided by department, level, term, section and sessional group.

## Users & roles

There are three account types: admin, teacher and student. Admin has two levels, **super admin** (university-wide) and **department admin** (one department only), so no single person holds all the control. CR and DCR are not separate account types — they are students given an extra role by their department admin, so everything a student can do, a CR or DCR can do too, plus the dashboard for their own section (including approving their classmates' UV ID claims).

| Role | Signs in with | Can do | Cannot do |
| --- | --- | --- | --- |
| Super admin (at least two accounts) | Own user ID + password + second step (first one seeded; others created by a super admin) | University-wide work: create and remove departments, create and remove department admins and other super admins, set the allowed email domains, create semesters and run the rollover, fix cross-department problems, read the full audit log, recover a department that has no admin. Can also do anything a department admin can, in any department | Be self-created from the sign-up page; remove the last super admin; read users' private messages |
| Department admin (one or more per department) | Own user ID + password + second step (created by a super admin) | For their own department only: approve/reject teacher registrations, choose and remove each section's CR and DCR, approve ID claims that no CR/DCR can handle, handle CR/DCR flags and removal requests, deactivate students and teachers, reset student passwords, import and edit routines, manage classrooms, link teacher short codes, read their department's audit log | Act on another department; create or remove admins; create departments or semesters; be self-created from the sign-up page |
| Teacher (after admin approval) | University email + password | Edit own profile, chat one-to-one, share files, view own teaching routine, see which rooms are free, request a free room (12-hour rule; the room's department admin decides), see the roster and "free now" list of sections they teach, send announcements to those sections | Approve CR/DCR, publish routines, see students of sections they do not teach, use the app before the admin approves the account |
| Student | University email + password (the UV ID is claimed after sign-up) | Edit own profile, claim their UV ID, and once the CR or DCR approves the claim: chat one-to-one, use the section group, share files, view own level–term–section–group routine | Publish routines, approve others, apply to be CR/DCR, use the app before the ID claim is approved |
| CR (student chosen by the department admin) | Same as student | Everything a student can, plus **request a free classroom** (the room's department admin decides), use the **CR/DCR dashboard** for their own section, and approve or reject UV ID claims from students of that section | Approve CR/DCR or teachers, publish or edit routines, delete or deactivate accounts, see other sections' students |
| DCR (student chosen by the department admin) | Same as student | Same as CR | Same as CR |

Notes:

- **Only the department admin of that department, or a super admin, approves or assigns teachers, CR and DCR; no other role can.** Teachers, students, CR and DCR have no way to approve, assign or remove these roles.
- A section has one CR and up to two DCRs. The system should block a second CR or a third DCR for the same section and tell the admin why.
- The UV ID is the student's institutional ID, issued offline and unique. Students do not pick it; they enter it after signing up to claim it, and the CR or DCR of their section approves the claim (see Student ID claim).
- The first super admin is seeded by whoever installs the system, and a second super admin must be created soon after so there is always a backup. Every other admin is created by a super admin; there is no public admin sign-up.

## Authentication & onboarding

Each role claims its account differently, but all land in the same profile editor afterward.

- **Teacher** signs up with a **university email + password** and verifies the email. The university email is their login from the start. The account then stays **pending** until the admin approves it (see Teacher approval); a pending teacher can sign in only to see a "waiting for admin approval" screen.
- **Student** signs up with a **university email + password** and verifies the email, like a teacher. After that they claim their unique UV ID in their profile (see Student ID claim). The email is used to sign in, for password recovery, and for the automatic messages the system sends to students.
- **Admin** (super admin or department admin) does not sign up. The first super admin's credentials are seeded at install; every other admin is created by a super admin. Admins log in with the user ID and password plus a second step.

First-login flow for a new teacher: sign up and verify email → wait for admin approval → complete profile → land on the dashboard.

First-login flow for a new student: sign up and verify email → fill in the join form (name, UV ID, department, level, term, section, sessional group; phone and photo optional) → the request goes to the CR and DCR of that section → wait for them to accept → land on the dashboard.

At the start of every new semester, a returning student must submit a new join form with their new level, term, section and sessional group, and the CR and DCR of that section accept it again (see Semesters and student updates and Sessional groups).

Password rules and recovery:

- Passwords are stored hashed (never plain text). The minimum is 8 characters with at least one letter and one number. After 5 wrong tries the account locks for 15 minutes.
- Teacher and student recovery are both by email link. Because a student's email is required, every student can recover their own password. Admin reset remains only as a fallback for a student whose email address no longer works.

Required university email (students and teachers):

- Students and teachers must sign up with an email address on the university's domain; the allowed domain or domains are set by a super admin, starting with `baiust.ac.bd`. Other addresses, such as personal Gmail, are rejected at sign-up.
- A student cannot sign in until they verify their email by clicking a link sent to that address.
- Each email can belong to only one student account.
- A student can change their email later, but the new address must also be a university address and must be verified before it replaces the old one. If an email stops working (bounces), the student is asked to update it at next login.
- The email is used to send the student automatic messages from the system. All automatic emails are sent from one system sender address, which the owner will set later. The emails sent are: email verification, password reset, join request accepted or rejected, semester update reminder, room request result, routine changed, and announcements. Students cannot turn these off, and chat messages are never emailed.
- Sessions should expire after a period of inactivity and on password change.

### Student ID claim

A student's email only proves they own an inbox. The UV ID proves who they are at the university. Because UV IDs are sequential and easy to guess, a student does not become a student by typing an ID; the CR or DCR of their section has to approve it. The CR and DCR know their classmates, so they do not need a student list.

1. After verifying their email, the student fills in the **join form** in their profile: name, UV ID, department, level, term, section, and sessional group (if they know it). The student chooses these themselves, but only from sections that already have a CR assigned by the admin.
2. The only automatic check is that the UV ID is not already used by another account; if it is, the request is blocked and the admin is told. The system does not check the ID against any ID range or student list.
3. The request goes to the CR and DCRs of the department, level, term and section the student chose, as a **pending join request**. Until it is accepted the student sees a "waiting for approval" screen. They can edit their profile but cannot see the routine, rooms or chats, and cannot message anyone, including the CR and DCR who will decide the request.
4. The CR or DCR sees the student's name, email, photo, UV ID, and the department, level, term, section and group they asked for. They decide whether the student belongs in that section, and can accept, reject (a reason is required for a rejection), or accept with a corrected sessional group. Whoever acts first decides, and the student is told by email.
5. On acceptance the account becomes active and the student enters that section; the routine appears automatically. The sessional group affects only sessional (lab) classes; theory classes depend on level, term and section only.
6. If the student chose the wrong section, the CR or DCR rejects the request with a reason and the student applies again to the right section.

Rules:

- A CR or DCR does not submit a join request for the section they lead: the admin's assignment is their approval (they must still have signed up and verified their email).
- A section with no CR is closed: it does not appear on the join form, and students cannot send a request to it until the admin has chosen its CR. DCRs are optional and can be added later.
- If nobody acts on a claim within 3 days, it moves to the department admin of that department.
- A student who failed a term cannot move up. Each semester they submit the join form again for the same level and term, and choose the section and group they will attend. The CR and DCR know who the repeat students are, so they accept them like any other student; no extra check is needed.
- If someone else claimed a student's ID, the real student reports it. The admin checks in person, can revoke the wrong claim, and the action is logged.
- A student who has 5 claims rejected is blocked from claiming for 24 hours. A rejected student can apply again, to the right section or with a corrected form, but cannot claim a UV ID that is already approved for another account.
- Every claim, approval, rejection and revocation is logged with who and when.

## Core features

Each feature below is a requirement. Priority: P0 = first release, P1 = soon after.

| # | Feature | What it does | Who | Priority |
| --- | --- | --- | --- | --- |
| F1 | Profile editor | Edit phone and profile picture; submit the join form (name, UV ID, department, level, term, section, sessional group) for the CR/DCR to accept; **required, verified university email** (add and change); view CR/DCR status | Teacher, Student | P0 |
| F1a | Semester update | At the start of each semester (for example Spring 2026, then Fall 2026) the student must submit a new join form with their department, level, term, section and sessional group, and the CR/DCR of that section accept it, before using the app | Student | P0 |
| F1b | Sessional group assignment | The CR or DCR sets or corrects each student's sessional (lab) group (G1, G2, G3, …) when accepting the join request; the group affects only sessional classes, never theory classes | CR, DCR | P0 |
| F2 | Direct messaging | One-to-one chat between any two active users, found by name search or from a profile; timestamps and sent/delivered/seen status (see Chat) | Teacher, Student | P0 |
| F2b | Chat safety | Block a user, report a message or user, delete own messages, chat suspension by the department admin (see Chat) | Teacher, Student, Admin | P0 |
| F3 | Section group | One group per section per semester, created automatically when the CR is named; accepted students are added automatically; teachers are not members; closed at rollover (see Chat) | Student, CR, DCR | P0 |
| F4 | CR/DCR assignment | The department admin chooses each section's CR and DCRs by hand (one CR, up to two DCRs); students do not apply | Department admin | P0 |
| F4a | Teacher registration approval | A new teacher account is held as pending until the department admin approves or rejects it | Teacher, Department admin | P0 |
| F4b | Student ID claim approval | A student submits a join form (UV ID, department, level, term, section, sessional group) after signing up; the request goes to that section's CR and DCR, who accept, reject, or correct the group | Student, CR, DCR | P0 |
| F5 | Approval dashboard | Department admin sees their department's pending teacher registrations and ID claims that need the admin, and manages CR/DCR assignments | Department admin | P0 |
| F5a | Admin dashboard and controls | One home page for each admin showing everything that needs attention in their scope (a department admin sees their department, a super admin sees all), plus the tools to manage semesters, routines, teachers, CR/DCR, students, classrooms and departments, with an audit log | Department admin, Super admin | P0 |
| F5b | Admin accounts and scope | Super admin creates and removes department admins and other super admins; every admin action is limited to the admin's own department (super admin: all); at least two super admins always exist | Super admin | P0 |
| F6 | Routine publishing | Department admin uploads the routine template and edits any slot on a routine page (add, edit, delete), then publishes routines per level–term–section for their department | Department admin | P0 |
| F7 | Routine viewing ("My routine") | A student opens the app and automatically sees their own routine, picked from the department, level, term, section and sessional group the CR or DCR accepted, with no manual searching or filtering; a teacher sees their own classes | Teacher, Student | P0 |
| F7a | Full week routine on the dashboard | The student's dashboard shows their whole week (Sunday to Thursday) as a weekly grid, with today highlighted and the class happening now marked | Student | P0 |
| F7b | Student dashboard | One home page for a student showing live status and countdown, today's classes, the full week, announcements, notifications, rooms, messages and profile reminders | Student | P0 |
| F7c | Teacher dashboard | One home page for a teacher showing teaching status and countdown, today's classes, the week, free students, rooms, messages and notices | Teacher | P0 |
| F7d | Teacher announcements | A teacher sends a message to a section or lab group they teach | Teacher | P1 |
| F8 | Free-room view | Pick a date (this week or next week) and a time slot and see which classrooms are free then, not only right now | Everyone | P0 |
| F9 | Room request | Request a free room for a dated slot, this week or next week, only if ≥ 12 hours ahead of the slot, with a note; a requester may send several requests; the room's own department admin approves one and rejects the rest (see Classroom booking rules) | CR, DCR, Teacher (requesters); Department admin, Super admin (deciders) | P0 |
| F9a | CR/DCR dashboard | A section-only dashboard for CR and DCR to monitor their section (roster, unconfirmed students, routine, live status, room requests) and act (request and cancel rooms, announce, approve student ID claims, flag problems) | CR, DCR | P0 |
| F9b | Section announcements | CR/DCR sends a message to the whole section or to one lab group | CR, DCR | P1 |
| F9c | Student removal request | CR/DCR asks the department admin to deactivate a student; only the admin acts on it | CR, DCR, Department admin | P1 |
| F10 | File sharing | Send PDF, Word, PowerPoint, Excel, text and image files (up to 5 MB) in one-to-one chats and section groups | Teacher, Student | P0 |
| F11 | Notifications | Alert on new message, approval result, booking result, routine change | Everyone | P1 |
| F12 | Live class status | Shows whether a student is **in class** or **free** right now, computed from their published routine; refreshes automatically every minute | Student (own), Teacher (students of sections they teach) | P0 |
| F13 | Next-class countdown | While in class, counts down to the end of the class; while free, counts down to the start of the next class | Student, Teacher | P0 |
| F14 | "Free now" student list | Teacher sees every student currently free in the sections they teach (and, optionally, who is in class), filterable by level, term, section and group | Teacher | P1 |
| F15 | University calendar | A super admin keeps one list of **holiday dates** for the whole university. On a holiday every student and teacher sees "No classes today" and all rooms count as free. The department admin can **cancel a single class** on one date. Outside the current semester's start and end dates, status shows "No classes". A super admin can also set a **special period** for the whole university: an exam period (regular classes do not run, status shows "Exam period") or a Ramadan period (one table of changed class times that every department follows, P1). | Super admin, Department admin | P0 |

F9's requester scope is decided: only CR, DCR and approved teachers can request a room, and the room's own department admin decides (see Classroom booking rules).

## Admin dashboard and controls

Admins run the system. This section collects the admin duties, which are described piece by piece elsewhere in this document, into one place. Control is split so that no single person is a bottleneck or a single point of failure.

**Who the admins are**

- **Super admin:** works across the whole university. There are always at least two, so one can cover for the other. The first is seeded at install; the others are created by a super admin.
- **Department admin:** works for one department only. Each department has at least one, appointed by a super admin; a department can have more than one so absence does not block it.
- Admin accounts cannot be created from the sign-up page.
- Every admin signs in with their own user ID and password, plus a second step: a one-time code sent to the admin's email, because these accounts control everyone else's access. A department admin who loses their password or email access is reset by a super admin, and a super admin by another super admin; every reset is logged. The owner names the second super admin at install, and a super admin appoints each department's first admin. The first version has no admin reports or exports and sends no email to admins; waiting items (new teachers, old claims) appear on the admin dashboard.
- Every admin action is checked on the server against the admin's department: a department admin cannot see or change another department's teachers, sections, students, rooms or routines.
- **Recovery:** if a department has no active admin, super admins are alerted and can act for it or appoint a new one. The last super admin cannot be removed or demoted.

**Super admin only**

- Create, rename and retire departments.
- Create and remove department admins and other super admins.
- Set the allowed university email domains.
- Create semesters, make one current and run the rollover.
- Fix problems that cross departments, such as a teacher who works in two departments.
- Read the full audit log.

**Admin dashboard (home page)**

A department admin sees these cards for their department only; a super admin sees them for every department, with a department filter. Cards show what needs attention, newest first:

- **Teacher registrations waiting** for approval (F4a), with approve and reject.
- **ID claims that need the admin:** claims no CR or DCR acted on in time.
- **Reports from CR and DCR:** flags and removal requests.
- **Routine problems:** the errors and warnings from the last import that are still open.
- **Room requests waiting:** requests for rooms the admin owns, grouped by room and slot, oldest first. For each, the admin sees the requester's section or department, the note, and the requester's other requests for the same time.
- **Current semester:** its name and status, and (for a super admin) the button to start a new semester.
- **Departments without an active admin** (super admin only).
- **Unconfirmed students:** who has not been accepted into a section for the current semester, per section.
- **Recent activity:** the latest entries of the audit log.

**What the admin manages** (a department admin: their own department; a super admin: all departments)

- **Semesters:** a super admin creates a semester (for example Fall 2026), makes it current, and runs the rollover; each department admin then finishes their department's part (CR/DCR, routine import) (see Semesters and student updates).
- **Routines:** upload the import template and check the preview, edit any slot on the routine edit page, and publish (see Routine file import, Import template and checks, Routine edit page).
- **Teachers:** approve or reject registrations, suspend or remove a teacher, and link each teacher account to its department and short code (see Teacher approval).
- **CR and DCR:** choose and remove them for each section (see CR/DCR assignment).
- **Students:** search for a student, deactivate an account, handle a request such as "someone took my UV ID", and set a student's sessional group by hand.
- **Classrooms:** keep the list of rooms with type (classroom or lab) and **owning department**. A room used by several departments is listed with each department that shares it, and the admin of any of them decides requests for it (the first decision is final); a super admin handles disputes. Room capacity is not tracked.
- **Room requests:** approve one request and reject the others for each room and slot (see Classroom booking rules).
- **Cancel a single class:** cancel one class of their department on one date (for example when a teacher is sick). The affected students and teacher are notified, and the room becomes free for that slot. The routine itself is not changed.
- **Special periods:** during exams and Ramadan every department follows the same timetable, so a super admin sets it once for the whole university. For an exam period the super admin enters the start and end dates; regular classes do not run and status shows "Exam period". For Ramadan the super admin enters the dates and one table that maps each regular class time to its Ramadan time (P1, later release). Department admins do not set these.
- **Holidays:** a super admin keeps one holiday list for the whole university. A holiday closes every department at once, and nobody has to cancel classes one by one (F15). Students and teachers see "No classes today", and all rooms count as free.
- **Departments:** a super admin keeps the list of departments used on the join form and in the routine.
- **Admin accounts:** a super admin creates and removes admins (see F5b).

**Rules**

- **Audit log:** every admin action, including creating or removing an admin, is logged with who, when, and the old and new values. The log cannot be edited or deleted. A super admin can read all of it; a department admin can read only their own department's entries.
- **Confirmation:** destructive actions (deactivate an account, remove a role, publish a routine) ask the admin to confirm first.
- **Nothing is hard-deleted:** removing a student or teacher deactivates the account and keeps its history, so a mistake can be undone.
- **Private chats:** the admin cannot read users' private messages.
- **Server checks:** every admin action is checked on the server, not only hidden in the page (see Non-functional requirements).

## Student dashboard

The dashboard is the first page a student sees after login. Everything on it is based on the student's level, term, section and lab group for the current semester, and a student who has not confirmed the semester update (F1a) sees the update screen instead. The page is a summary: each card links to the full feature.

**1. Right now (top of the page)**

- **Live status:** "In class" or "Free", from the routine (F12). On Friday and Saturday it says "No classes today".
- **Countdown:** time left in the current class, or time until the next one (F13), refreshed every minute.
- **Current or next class card:** course, the full name of the teacher for the student's group, room and time.

**2. Routine**

- **Today's classes** in time order, with the current one marked.
- **Full week grid** from Sunday to Thursday (F7a), with today highlighted.
- **Tomorrow preview:** the first class tomorrow and its start time, so the student knows when they must arrive.

**3. Notices**

- **Announcements** from the CR, DCR, a teacher who teaches the section, or the admin, for the student's section or lab group (F7d, F9b; P1, later release), newest first. A student can never mute announcements.
- **Notifications** for routine changes, approval results and room request results (F11; P1, later release), with an unread count.
- **Unread messages** count for direct chats and groups (F2, F3), linking to the chat.

**4. Rooms**

- **Free rooms now** from the free-room view (F8). Students can look but cannot request a room; only CR, DCR and teachers can.

**5. My section**

- **CR and DCRs** of the student's section, with a button to message them. The button is shown to every student with an active account, including unconfirmed students, so a new-semester student can message the CR to ask for acceptance.
- **Courses this semester** with the full name of the teacher of the student's group for each course, taken from the routine, so group-specific teachers are shown correctly.
- **ID claim status** while the claim is pending or rejected, and a link to the CR/DCR dashboard if the student holds the role.

**6. Profile reminders**

- **Level, term, section and sessional group** shown read-only, as accepted by the CR or DCR.
- **Semester badge** such as "Fall 2026 confirmed", with a warning when the update is overdue.
- **Email status:** a banner if the student's email is missing or unverified.
- **Group notice** if the CR or DCR has not set a sessional group yet (see Sessional groups).

Rules:

- Cards only show data the student is allowed to see. A student never sees another section's routine, bookings or student list; chat search shows only name, photo, department and role.
- The dashboard works on a phone first: cards stack in one column, and the week grid becomes a day-by-day list (see F7a).
- A card with nothing to show is hidden or shows a short empty message, never a blank box.
- Priority order on a small screen: status and countdown, today's classes, notices, rooms, section, profile reminders.
- The dashboard loads in under ~2 seconds and the status and countdown refresh on their own without reloading the page.

## Teacher dashboard

The dashboard is the first page an approved teacher sees after login (a pending teacher sees only the waiting screen; see Teacher approval). Everything on it is based on the classes assigned to the teacher's linked short code in the current semester's routine. Each card links to the full feature.

**1. Right now (top of the page)**

- **My status:** "Teaching" or "Free", from the classes assigned to the teacher (same rule as F12, applied to the teacher instead of a student). On Friday and Saturday it says "No classes today".
- **Countdown:** time left in the current class, or time until the next one (F13), refreshed every minute.
- **Current or next class card:** course, section, lab group, room and time. For a lab shared with another teacher, both teachers' full names are shown.

**2. My routine (F7)**

- **Today's classes** in time order, across all sections, with the current one marked.
- **Full week grid** from Sunday to Thursday. A teacher teaches several sections and several lab groups of the same course, so each cell shows the course, section, group and room.
- **Next teaching day preview** when there are no more classes today.

**3. Students**

- **"Free now" list (F14; P1, later release):** students currently free, filterable by level, term, section and group. For a teacher it covers only the sections they teach.
- **Section roster:** for each section the teacher teaches, the students with name, UV ID and lab group. A teacher cannot open the roster of a section they do not teach.

**4. Rooms (F8, F9)**

- **Free rooms:** the free-room view (F8) with a date and time picker, and a request button next to each free room.
- **My room requests** and whether each is pending, approved, rejected, cancelled or expired (F9). A teacher may send several requests; the same rules apply as for a CR or DCR (see Classroom booking rules).

**5. Messages and notices**

- **Unread messages and groups** count (F2, F3), linking to the chat.
- **Notifications** for routine changes and approval results (F11; P1, later release), with an unread count.
- **Announcements:** the teacher can send an announcement to a section or lab group they teach (F7d; P1, later release). It is emailed to those students and logged with the sender and time. Announcements from the admin appear here too.

**6. Account**

- **Linked short code and name** from the routine sheet. If the account is not yet linked, a notice asks the admin to link it.
- **Profile reminders** when email, phone or photo is missing.

What teachers cannot do or see:

- A student's location, messages or attendance, and any section's roster outside the sections they teach.
- Another user's private chats.
- Admin controls: approvals and routine import.

Rules:

- Cards only show data the teacher is allowed to see. Roster and announcement access is derived from the routine: a teacher qualifies for a section only if they are assigned to at least one of its slots this semester.
- Teachers are identified by department + short code. If the same code appears twice inside one department, the account cannot be linked until the admin fixes the import, and the dashboard shows the unlinked notice.
- The dashboard works on a phone first: cards stack in one column and the week grid becomes a day-by-day list.
- A card with nothing to show is hidden or shows a short empty message.
- It loads in under ~2 seconds and the status and countdown refresh without reloading.

## CR/DCR dashboard

CR and DCR have the same dashboard. It is scoped to **one section and one semester** (for example 3-II-A, Fall 2026). They never see another section's students. The dashboard is the only place where a student has more power than other students, and it ends at semester rollover with the role itself.

**Monitor (read-only views)**

- **Section roster:** every student in the section with name, UV ID, lab group, profile photo, and whether their profile is confirmed for this semester. Phone and email are never shown here (see Privacy for the one exception on join requests).
- **Unconfirmed students:** students who have not done the semester update, with a button to send them a reminder (limited to one reminder per student per day).
- **Section routine:** the published routine for the section, today's classes first, and which classes are happening now.
- **Live status:** who in the section is in class or free right now, with the countdown (F12/F13).
- **Free rooms:** the free-room view (F8) with a date and time picker, and a request button next to each free room.
- **Room requests:** all of the section's room requests and whether each is pending, approved, rejected, cancelled or expired, with the reason.
- **Flags:** the status of anything the CR or DCR reported to the admin (open, fixed, rejected).

**Act**

- **Request a free room** for the section under the 12-hour rule (F9), several rooms if wanted, each with a note, and **cancel** the section's own request or approved room.
- **Send an announcement** to the whole section or to one lab group (F9b; P1, later release). Announcements are also emailed to those students (F11) and are logged with the sender. They need no review before sending; the admin can see and remove them afterward.
- **Accept or reject join requests** from students of their section, and set each student's sessional group (see Student ID claim). The CR and DCR use what they know about their classmates; no student list or ID range is checked.
- **Flag a problem to the department admin** (up to 5 a day), for example a student in the wrong section or group, a missing student, or a routine mistake. The admin sees the flag with who raised it and when.
- **Request removal of a student** (F9c; P1, later release), up to 5 a day. The request says who and why. It does not delete anything, and the student is not told about the request.

**What a CR or DCR cannot do**

- Delete or deactivate any account. Only the admin can, and every removal is logged with who and when, so a mistaken request can be reversed. Student history is kept.
- Approve CR/DCR or teachers.
- Publish or edit routines.
- See students, bookings or flags of any other section.
- Change a student's profile, section or group. A change is made by the student, or by the admin after a flag.

**Rules**

- Both CR and DCR can act. If two of them act on the same request, the first action wins and the other sees that it is already done.
- Every action on the dashboard is logged with who and when, and the admin can see the log.
- If a CR or DCR loses the role (end of semester, removed by the admin), the dashboard disappears at once and anything they started stays with the admin.

## Chat

Chat is deliberately small: one-to-one messages between any two people, one group per section per semester, and sharing of study files. It is not meant to replace WhatsApp as a general messenger, so it has no user-created groups, calls, stories or message search in the first version.

**Who can use chat.** Any person with an active account can message any other active person; being a CR, DCR, teacher or admin makes no difference. This includes students who are unconfirmed (new semester, not yet accepted), so they can message their CR. Only a teacher whose account is still pending approval cannot open chat.

### One-to-one chat (F2)

- Any active user can chat with any other active user, in any section or department.
- **Finding people:** a user searches by name. The result shows name, photo, department and role (student, teacher, CR or DCR). It does not show level, term, section, group, phone or email. A user can also start a chat from a person's profile, the section roster, or the CR/DCR card on the dashboard.
- **What others see on a profile:** name, photo, department and role. Phone and email are never shown on a profile (see Privacy for the two exceptions on join and registration requests).
- A message is plain text up to 4,000 characters with a timestamp. In a one-to-one chat it shows sent, delivered and seen.
- A sender can delete their own message for everyone; it is replaced by "message deleted".
- One-to-one chats continue across semesters. They do not reset at rollover.

### Section group (F3)

- Every section has one group per semester, named like "CSE 2-II-A · Fall 2026".
- **Created automatically** when the department admin names the section's CR. The CR does not have to create it, so no semester starts without one.
- **Members:** the CR and DCRs (as group owners) and the section's accepted students, who are added automatically when the CR or DCR accepts their join request. Teachers are not members of any group.
- Only members can read or send. Students from other sections cannot join.
- The CR and DCR can delete any message and remove a member from the group. They cannot delete accounts.
- **At rollover** the group is closed: nobody can send, but the messages stay readable as history. A new group is created for the new semester as soon as the new CR is named, and students enter it when they are accepted into the section again. Students who move to a new section leave the old group and join the new one.
- Announcements (F7d, F9b) remain a separate one-way feature. They are not replaced by group posts.

### Sharing files (F10)

- Users can send a file in a one-to-one chat or in a section group, for example study material.
- Allowed types: PDF, Word (doc, docx), PowerPoint (ppt, pptx), Excel (xls, xlsx), plain text and images. Other types are rejected.
- Maximum size of one file: 5 MB. Files are scanned for malware before they are available.
- A file is visible only to the members of that conversation or group, never through a public link.
- In a closed group, files stay downloadable as history.

### Safety (F2b)

Because anyone can message anyone, there are three light tools:

- **Block:** a user can block someone, who then cannot send them a message. A user cannot block an admin, and blocking does not stop announcements or notices.
- **Report:** a user can report a message or person with a reason. It goes to the department admin of the reported person (a super admin for admins). The admin sees only the reported message and a few messages around it, not the rest of the conversation.
- **Chat suspension:** a department admin can suspend a user from sending messages for a set time, with a reason. The user is told and the action is audited. Everything else in the app keeps working.

### Notifications

A new message adds an unread count on the dashboard and in the chat list, and a browser notification if the user allowed it. Chat messages are not emailed. Email is the only other channel, and it follows the list under Authentication & onboarding.

### Privacy and retention

- Messages travel over HTTPS and are encrypted on the server. They are not end-to-end encrypted in the first version, because reporting needs the server to produce a reported message.
- The admin cannot read private conversations. The only exception is the reported-message view above, and each such view is audited.
- Messages and files are kept until 12 months after the end of the semester they belong to, then deleted automatically; deleted messages are removed from view at once.

## Teacher approval

Anyone can reach the teacher sign-up page, so a teacher account is not trusted until an admin checks it. Teachers are approved by the department admin of the department they register under (or a super admin), not by other teachers or students.

1. A teacher signs up with email + password and verifies the email.
2. The account is created as **pending**. The teacher can sign in only to a "waiting for admin approval" screen; they cannot message, see student profiles or see routines.
3. The admin sees the request in the approval dashboard (F5) with the teacher's name, email, department and short code (for example `MYA`). Approval is the admin's own judgment; no teacher list is needed.
4. The admin approves or rejects (a reason is required for a rejection). The teacher is told the result by email.
5. On approval the account becomes active, and the admin links the account to the teacher's short code from the routine sheet so the teacher's own classes appear in "My routine" (F7).
6. Approval and rejection are logged with who and when.

Rules:

- Only that department's admin or a super admin can approve teachers; there is no self-approval and no way to become admin through this flow.
- A rejected teacher can re-apply, but the admin sees the earlier rejection.
- The admin can later suspend or remove an approved teacher (for example when they leave the department).
- A teacher is identified by department + short code, so the same code in two departments (for example `AR` in CSE and in CE) is fine. The same department + code cannot be linked to two active accounts.

## CR/DCR assignment

The department admin chooses each section's CR and DCRs by hand. Students do not apply, because the admin knows who should lead each section.

1. The department admin opens the section (for example 3-II-A, Fall 2026) and picks a student who has signed up and verified their email. No approved ID claim is needed first: the admin knows who should lead the section, and the admin's choice is the approval.
2. The admin sets the role: CR or DCR.
3. The system blocks a second CR, or a third DCR, in the same section and tells the admin why.
4. The student sees the role on their profile and gets the CR/DCR dashboard. The assignment is logged with who and when.

Rules:

- A role belongs to one section and one semester. It ends at rollover and the admin chooses again for the new semester.
- The admin can remove a role at any time.
- A section opens for join requests only after the admin has named its CR. The admin names the CR and DCRs first, then students apply and the CR/DCR approve them.

## Classroom booking rules

```mermaid
flowchart TD
  A[CR, DCR or teacher picks a free room, target section and note] --> B{Checks: room free, at least 12 h ahead, this or next week, under the 3-request limit}
  B -- fails --> X[Blocked, reason shown]
  B -- passes --> C[Pending request]
  C --> D{Admin of a department that uses the room decides, up to 2 h before the slot}
  D -- no decision by cutoff --> E[Rejected as expired]
  D -- rejects --> F[Rejected]
  D -- approves --> G[Booked: shown as Booked to everyone and added to the target section's routine and status]
  G --> H[Overlapping requests of the same requester cancelled; other requests for the room and slot rejected]
  G --> I[Requester or admin may cancel at any time; room becomes free]
```

A room is **requested**, not booked. A request becomes a booking only when the department admin of the room's own department approves it.

**Booked rooms.** As soon as a request is approved, the room shows as **Booked** for that date and time to everyone who can see the free-room view (F8): students, CR, DCR, teachers and admins. The request button is removed for that slot, and the server rejects any new request for it, even from a stale screen. Other users see only "Booked", not which section or teacher holds it. The room becomes free again only if the requester cancels (or the admin cancels the booking), and the free-room view updates at once.

**What an approved booking does.** The booking is tied to its target section (or group) and appears as a dated one-off class in that section's routine, My routine, and live status, so students no longer see "Free" during it. It also appears in the booking teacher's own routine and status. The affected students (and the teacher, if the CR booked) get a notification when it is approved or cancelled. It shows only on its date and never changes the weekly routine.

**Who can request:** CR, DCR and approved teachers. Ordinary students cannot. Each of them sees the free rooms on their own dashboard (F8) and sends the request from there.

**What a request is:** one room for one dated slot. The routine repeats weekly, but a request is for a specific date, for example "Room 311, Tuesday 11 November, 11:15–12:15". It may cover several periods in a row on the same day, up to 3 hours in total. The requester is the **section**: a CR or DCR sends a request on behalf of their section, and the system records which of them sent it. The requester must write a short note saying why and must name the **target section** (and the sessional group, if only one group attends). A CR or DCR can only target their own section; a teacher picks from the sections they teach. A request without a target is blocked.

**Checks when a request is sent** (all must pass, otherwise it is blocked and the requester is told why):

1. **Free slot:** no published routine class and no approved request uses that room on that date and time. Other pending requests do not block it. Once a request is approved the room is **booked** and no one can request it again for that slot (see Booked rooms).
2. **12-hour rule:** the request is sent at least 12 hours before the slot starts. Example: a room used from 10:00 to 11:00 and free from 11:15 to 12:15 can be requested for 11:15–12:15 until 11:15 pm the evening before.
3. **Window:** the slot is in the current week or the next week. Nothing further ahead.

**Several requests:** a requester (a section, or a teacher) may have up to 3 open requests for the same date and time, and more for other dates, for different rooms or slots, so that losing one room still leaves a chance at another. The limit is shared by the CR and DCRs of a section, so a section never has more than 3. When one of a requester's requests is approved, their other requests whose time **overlaps** the approved time on that date are cancelled automatically, so nobody holds two rooms at once.

**Who decides:**

- Every room has an owning department, and that department's admin decides requests for it. A room shared by several departments is listed with every department that uses it, and the admin of **any** of those departments can decide its requests. The first decision is final and locks the request for the others. A super admin steps in only for a dispute.
- Requests for the same room and slot appear on the admin's dashboard oldest first. The order is only for display; the admin picks which section or teacher gets the room. The admin also sees the requester's other requests for the same time.
- Approving one request rejects the other requests for that room and slot.
- **Decision cutoff:** an admin can approve or reject a request only until **2 hours before the slot starts**. A request nobody has decided by then is **rejected automatically** as expired, so the requester can plan.
- Every requester is told the result. A requester who loses is told the room went to another section.

**Cancelling and no-shows:**

- A requester can cancel an approved room **at any time**, and the room becomes free for others again at once. A cancel made less than 6 hours before the slot is logged, so the admin can see patterns.
- The admin can add a note on an approved request after the slot if the requester did not use the room. The note stays on record for later decisions. No other penalty in the first version.

**When the routine changes:** if a routine edit or re-import would put a class in a room and slot with an approved request, the admin gets a warning naming the affected requester (see Routine edit page).

A requester (a section or a teacher) may have at most 3 open requests for the same date and time.

## Routine management

The department admin owns the routine of their department; everyone else reads it. A routine is a weekly grid of time slots mapped to a subject, a teacher and a classroom, scoped to one level–term–section.

How it works:

1. Admin creates a routine for a level, term and section — for example, Level 2, Term 1, Section A.
2. For each slot (day × time), admin assigns subject, teacher and room.
3. Admin publishes it. Publishing is what makes it visible to students and teachers.
4. A student opens "My routine" and sees only the routine for their own level, term, section and lab group — no manual filtering. The app uses the level, term, section and sessional group that the CR or DCR accepted (F1b), so the right routine appears as soon as they accept the student.

### Routine file import

The uploaded file is the starting point for the routine: classes, teachers, rooms and sessional groups. The app does not invent or guess any of it. Once it is imported, the routine in the app is the source of truth, and the admin can correct it on the routine edit page (see Routine edit page).

1. Every semester, a teacher gives the department's new Excel sheet to the department admin. The sheet changes every semester, so last semester's data is never reused.
2. The department admin uploads the filled import template to the new semester (see Import template and checks). The "Level wise Student number" sheet is not used to place students.
3. Before publishing, the admin sees a preview and a list of problems found in the file (see the data-quality list in Import template problems, for example inconsistent batch labels or a short teacher code used by two people). The admin fixes the file or corrects the entries, then publishes.
4. Publishing is what makes the new routine take effect for the students of each section.
5. If the teacher later sends a corrected sheet, the admin re-imports it for the same semester. Before anything is replaced, the admin sees what would change, including any slots the admin edited by hand on the routine edit page, and chooses what to keep. This is logged with who and when, and affected students are notified (F11).
6. Only the department admin (or a super admin) can import, and only for their own department's batches. Teachers and students never edit the routine directly.

### Import template and checks

The department's current Excel sheet is made for people to read: merged cells, free-text times such as `(12.00pm- 2.00pm)`, notes inside cells, and labels like `4-I` that Excel turns into a date. A program cannot read it reliably. So the first version imports a **clean template**, and the department's sheet is copied into it once per semester. Reading the old layout directly is out of scope for the first version; it would be a project of its own (merged cells, special times, mangled labels). The department admin copies the sheet into the template once per semester, and the columns are those listed under Routine file import. There is no converter for the old sheet in the first version. Problems seen in the current sheet that the template avoids: inconsistent batch labels (for example `3-1-A` vs `3-I-A`, and `4-I` stored as a date), a duplicated `CSE-301 (G1)` slot in one row, and a short code (`AR`) used by both a CSE and a CE teacher without a department written on the class.

Template, one row per class slot, plain text with drop-down lists where possible:

- **Department** (for example CSE, EEE, CE, LAW), **level** (1–4) and **term** (I or II) as separate text columns, **section** (A, B, C) and **group** (G1, G2, … or empty for the whole section). Classes for other departments' batches, such as Law or Civil students taught by CSE teachers, are normal rows with that department.
- **Day** (Sunday to Thursday), **start time** and **end time** in 24-hour form (for example 12:00 and 14:00). A lab over several periods, or a class with its own time, is just one row.
- **Course code** and course name.
- **Teachers**, each written as department:code (for example `CSE:AR`), separated by a plus sign when two teachers share a class. `TBA` is allowed.
- **Room**.
- A second sheet lists the teachers (department, short code, full name) and a third lists the rooms (room, type, owning department).

Checks run when the admin uploads the template. The admin sees the full list and the preview before anything is published.

The department's own sheet is planned together with its main teacher and does not contain real double-bookings. An overlap is therefore usually a legitimate combined class (two sections sitting together, or a shared lab), which takes one row per section with the same teacher, room and time. Overlaps are therefore warnings, not errors. They are still checked because the template is copied by hand from the Excel sheet each semester, and a typo in a time, room or teacher code would show up as an overlap.

Errors (publishing is blocked until fixed):

- **Unknown teacher:** a teacher code that is not in the teacher list (for example `AA` or `NR` in the current sheet).
- **Unknown room**, a missing required field, an unreadable day or time, an end time before the start time, or a day outside Sunday to Thursday.

Warnings (the admin can accept them):

- **Teacher overlap:** the same teacher has two classes that overlap in time on the same day. If the rows share the same room and time, the admin can confirm it as a combined class.
- **Room overlap:** the same room is used by two classes that overlap in time. The same confirmation applies for a combined class or a shared lab.
- **Section overlap:** a section or group has two classes at overlapping times, including a whole-section class that overlaps a group's lab.
- A teacher is `TBA`.
- The same course and group appear twice on one day (this would flag the duplicated `CSE-301 (G1)` in the current sheet).
- A class starts before 8:30 or ends after 17:30.

Fixing is done in the template and re-uploading it. Nothing is published, and no student sees any change, until the admin publishes with zero errors.

### Routine edit page

The uploaded file can have mistakes, and the routine can change during the semester. So the admin does not have to upload a new file for every fix: after the import, the admin can change the routine on a web page.

- The page shows the routine of one department, level, term and section as a weekly grid, in the same layout students see.
- The admin can **add** a class slot, **edit** its course, teacher, room, day, time or group, and **delete** it.
- Every add, edit and delete goes through the same conflict checks as the import (an unknown teacher or room is an error; a teacher, room or section overlap is a warning the admin can confirm). A change with an error cannot be saved.
- A change that puts a class in a room and slot with an **approved room request** is not an error, but the admin gets a warning naming the affected requester. The admin chooses whether to keep the class or cancel the request; the requester is told either way.
- Every change is logged with who, when, and the old and new values. The students and teachers affected are notified (F11).
- A saved change on a published routine shows to students right away.
- Only the department admin of that department (or a super admin) can use this page. CR, DCR, teachers and students cannot edit the routine.

### Sessional groups

Theory classes are for the whole section, but sessional (lab) courses are split into groups so that each group fits a lab. For example, a 2-II batch has a Data Structures and Algorithms sessional that is split into G1, G2 and G3. Each group has its own teacher (or pair of teachers), day, time and lab room: G1 may be taken by one teacher on Sunday in one lab, G2 by a different teacher on Tuesday, and G3 by another teacher on Thursday. The course is the same, but the teacher, time and room are not. Two students in the same section can therefore have different routines, and see different teachers for the same course.

How a student's group is decided:

1. A student's routine is decided in this order: **level → term → section → group**.
2. The student chooses level, term and section on the join form and may suggest their group. The CR or DCR who accepts the request decides the final group, because they know which group each classmate belongs to. The system does not check the UV ID against any ID range.
3. The list of groups for each section (G1, G2, …) comes from the imported routine Excel sheet, so the CR or DCR picks from groups that really exist for that section.
4. The group applies only to sessional (lab) courses. Theory classes depend only on level, term and section.
5. A lab slot tagged with a group (such as `CSE-422 (G1)`) is shown only to students whose group matches, with that group's teacher (full name), time and room. Slots for the whole section (no group tag) are shown to everyone in it.
6. Because every group has its own teacher, the routine stores teacher, time and room per group, never per course. A teacher's own routine (F7) is built from the group slots they are assigned to, so a teacher can appear in several groups of the same course, and a student sees only their own group's teacher.

Edge cases the system must handle:

- **Student does not know their group:** they leave it empty and the CR or DCR sets it when accepting. Until a group is set, the student sees only the whole-section (theory) classes with a notice.
- **Wrong group:** the CR or DCR can change a student's group later, and the change is logged.
- **Admin override**: the admin can set a group manually for one student, and that override is kept and logged.
- **Group changes between semesters** are expected, since groups differ by level and term.

Routines follow the semester: every semester (about six months) the admin publishes a new routine, and the old one is archived, not deleted, so history stays. The super admin sets the start and end dates of each semester.

### Semesters and student updates

Each six-month period is a named **semester**, for example Spring 2026 or Fall 2026. The admin creates the semester, publishes its routines, and marks it as the current one. A student's level, term, section and sessional group are only valid for one semester, because students move up (for example from 2-I to 2-II) and may change section or group. At each rollover the student submits them again and the CR and DCR of the new section accept them.

How the rollover works:

1. When a super admin makes a new semester current, every CR and DCR role ends and every student's saved level, term, section and sessional group are marked **unconfirmed** for it. Each department admin then chooses the new CR and DCRs for each section. For every section the admin sees who was CR and DCR last semester and can re-appoint them with one action or pick different people; a section stays closed to join requests until its CR is chosen.
2. The next time a student logs in, they are shown the semester update screen and cannot use "My routine", live status, room requests or the rest of the app until they confirm. It is the join form, pre-filled with last semester's values and the suggested next term (for example 2-I becomes 2-II). The student fills in or changes level, term, section and sessional group, and the request goes to the CR and DCR of the section they chose, who accept it again.
3. When the CR or DCR accepts the request, the student's profile is stamped with the semester it was confirmed for (for example "Fall 2026").
4. From then on, everything the student sees is based on those five values (department, level, term, section and sessional group) for the current semester: their routine, the live in-class or free status and countdown, the section's CR and DCR, and the free-room view.
5. Last semester's values and routine stay in the student's history and are never overwritten.

Rules:

- A student who failed the term repeats the same level and term, so the suggested next term on the pre-filled form is changed back by the student. Their section and group may differ from last time, and the CR or DCR sets the group when accepting.
- A student who is on a break and has not confirmed sees only the update screen and their profile; the app does not guess their section.
- Students who have not confirmed within 14 days of the semester becoming current appear in an "unconfirmed students" list for the admin, so they can be followed up. The deadline does not lock anyone out; an unconfirmed student stays on the update screen until accepted.
- A student's CR or DCR role belongs to a section and semester. It ends at rollover and the admin chooses the CR and DCR again for the new semester.
- The student's profile always shows the semester it was last confirmed for, so a wrong or stale section is easy to spot.

The routine is also the source of truth for free rooms (next section): a room is free in a slot when no published routine class, and no approved booking, uses it on that date. On a holiday, or when the class is cancelled for that date, the routine does not use the room.

### My routine (student view)

- **Automatic:** the student never chooses a routine. The routine follows the level, term, section and sessional group the CR or DCR accepted, and the app shows the matching published routine.
- **Today first:** the page opens on today's classes, then offers the full week (Sunday to Thursday). Each class shows time, subject, the teacher's full name and room.
- **Full week on the dashboard (F7a):** the student's dashboard has a weekly routine, so they do not need to open another page to plan their week.
  - It is a grid with the days (Sunday to Thursday) as rows or columns and the time slots (8:30–9:25 up to 4:35–5:30) on the other axis, matching the layout of the department's Excel sheet.
  - Each filled cell shows the course code, the full name of the teacher for the student's own group (the short code if the cell is too small, with the full name shown on tap), and the room. Empty cells are free periods.
  - A lab that runs for several periods is shown as one block across those periods, and classes with their own time (for example 12:00–3:00) are placed at that time.
  - Today's column or row is highlighted, and the class happening right now is marked, with the live status and countdown (F12/F13) shown above the grid.
  - It shows only the student's own section and group, so classes of other groups are never listed.
  - On a phone, the grid switches to a day-by-day list with swipe or tabs between days, because a nine-period grid does not fit a narrow screen.
  - The week shown is always the current semester's published routine, and it updates when the admin imports a changed sheet.
- **Group-aware:** a lab tagged for one group (for example G1) is shown only to that group. Classes for the whole section are shown to everyone in it.
- **Teacher names:** wherever a class is shown to a student, the teacher is shown by **full name** (for example "Arifur Rahaman"), not only the short code from the sheet. The app finds the name by looking up the short code, together with the department, in the teacher list of the import template. A class with two teachers shows both names. If the teacher is `TBA`, it shows "Teacher to be announced". Where there is very little space, such as a cell in the week grid, the short code may be shown and the full name appears when the student taps the cell.
- **Always current:** when the admin publishes a changed routine, the student sees the new one on their next visit with no action on their part. Archived routines from earlier terms are not shown here.
- **Missing data:** if the student's join request is not accepted yet, the page shows the waiting screen. If no sessional group has been set yet, the page shows the whole-section classes with a notice that the CR or DCR must set a group, instead of showing a wrong routine.

## Live class status

The routine already says who has which class when, so the app can also answer "what is this student doing right now?" without any extra data entry.

How status is decided (F12):

1. Take the student's level, term, section and sessional group, as accepted by the CR or DCR.
2. Take the current day and time in the institution's timezone (Bangladesh time), not the viewer's device clock.
3. Look in the student's published routine for a slot on that day whose start–end time contains the current time.
   - A match means **In class**. Show the subject, the teacher's full name, room and end time.
   - No match means **Free**. Show when the next class starts.
4. A class applies to a student if it is for their whole section, or for their lab group. Lab slots tagged with a group (for example G1 or G2) apply only to that group; the same section can be in a lab and free at the same time.
5. On a **holiday** (see University calendar, F15) or outside the current semester's start and end dates, the status shows "No classes today" for everyone. A class the department admin has **cancelled for that date** shows as cancelled and counts as free time. On non-teaching days (the routine runs Sunday to Thursday) the status shows "No classes today" rather than "Free", and the countdown points to the next teaching day's first class.

Countdown (F13):

- **In class:** "Class ends in 25 min".
- **Free:** "Next class CSE-421 with Arifur Rahaman in 1 h 10 min, Room 311". If there are no more classes today, it counts down to the first class of the next teaching day.
- The status and countdown refresh on their own every minute while the page is open. No manual reload is needed.

"Free now" list for teachers (F14):

- A teacher opens a list of students who are free at this moment, with the time each one's next class starts, so the teacher can see who is available, for example for a makeup class or a meeting.
- The list can be filtered by level, term, section and group, and switched to show who is in class.
- Because status comes from the section and group routine, every student in the same section and group shows the same status. An individual student's status is only as accurate as the section and group the CR or DCR accepted.
- Teachers see only what the routine implies (in class or free), never a student's location, messages or attendance.

**Scope notes for live status.** Teachers can always see whether a student in their sections is in class or free; students cannot hide it. Showing the academic calendar (exams and holidays) and class-cancelled or room-changed alerts on the student dashboard is left out of the first version. Holidays and single-class cancellations themselves are in the first version (F15).

## Non-functional requirements

- **Security.** Passwords hashed with a modern algorithm (bcrypt/argon2). All traffic over HTTPS. Role checks enforced on the server, not just hidden in the UI — a student cannot reach admin actions by guessing a URL.
- **Privacy.** A user's phone number and email are visible only to that user on their own profile. No other user can see them, including students, CR, DCR, teachers and admins; there is no setting to share them. There are only two exceptions, both limited to the person deciding a request: the CR or DCR sees a student's email on that student's join request, and the admin sees a teacher's email on that teacher's registration request. Everywhere else (rosters, profiles, chat, admin lists) admins see only whether an email is verified or bouncing, never the address. Email is used only to identify the user, for recovery, and for the system's own automatic messages to that user, never shared externally.
- **Stored data.** Passwords are hashed (bcrypt or argon2) and cannot be read back. Email and phone cannot be hashed for storage, because the system must read them back to send mail and to show them to the owner; they are stored encrypted, with the key kept outside the database. A separate hashed copy of the email is used to check that an address is not already taken and to find the account at sign-in.
- **Authorization.** Every routine-edit, approval and booking action is checked against the caller's role and scope (a CR can request rooms and approve their own section's ID claims; only a department admin, for their own department, or a super admin chooses CR/DCR). Every admin action is also checked against the admin's department.
- **Performance.** Routine and free-room views should load in under ~2 seconds for a section. Messaging should feel real-time (delivery within ~1–2 seconds). The live status and countdown are computed from the already-loaded routine, so the minute refresh needs no extra server call; the teacher "free now" list loads in under ~2 seconds for the sections that teacher teaches.
- **Platform.** Responsive web app, works on phone and desktop browsers. No native app required for the first release.
- **Availability & data.** Daily backups; archived routines retained and chat history kept as set under Privacy and retention. Account lockout for 15 minutes after 5 failed logins.
- **Auditability.** Admin approvals, rejections, CR/DCR assignments, ID claim approvals and revocations, routine publishes, creation or removal of admin accounts, chat suspensions, and every admin view of reported chat messages are logged with who and when.

## Open questions

None at the moment. Every question raised so far has a decision in the sections above. New questions are added here as they come up.
