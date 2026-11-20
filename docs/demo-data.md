# Demo data

`npm run seed:demo` fills an empty development database so every screen and flow can be tried by
hand, including the cases the app must refuse. It is safe to run again: a second run on the same
day creates nothing. It refuses to run when `NODE_ENV=production`.

## Before you run it

- **Use a throwaway database.** Point `MONGO_URL` at a new database name (for example
  `mongodb://localhost:27017/crm_demo?replicaSet=rs0`). The script never deletes anything, but it
  adds about 1,400 documents.
- **Turn real email off.** The demo addresses use the real university domain. Run the dev server
  with `SMTP_USER` empty so mail goes to the dev outbox (`http://localhost:4000/dev/outbox`)
  instead of out. The script prints a warning when SMTP is configured.
- A super admin must exist first.

```sh
# server/.env: MONGO_URL=...a new database name...
npm run seed:super-admin -- --email <you>@baiust.ac.bd --name "<your name>"
#   open the printed link to set the super admin's password
npm run seed:demo
npm run seed:demo          # again: "0 new documents"
SMTP_USER= npm run dev:server
npm run dev:client         # http://localhost:5173
```

Values set in the environment win over `server/.env`, so `MONGO_URL=... npm run seed:demo` works
without editing the file.

## Signing in

- **Password for every demo account:** `Demo@12345`
- **Admins** (super admin and department admins) sign in with email and password only. There is no authenticator or second step.
- Your own super admin keeps the password you set through the link.
- **Extra sections (added later):** CSE 3-II-A, 3-II-B, 3-I-B, 4-I-A, 4-II-A and 4-II-B (prefixes
  `cse3iia`, `cse3iib`, `cse3ib`, `cse4ia`, `cse4iia`, `cse4iib`; CSE 4-II-B has no CR yet), BBA 3-I-A and
  4-I-A (`bba3ia`, `bba4ia`), and 3-I-A and 4-I-A in EEE, CIV, LAW and ENG (`eee3ia`, `eee4ia`, and so
  on; the 4-I-A sections have no CR yet). Eight more CSE teachers sign in as `<code>.t@baiust.ac.bd`
  (`ar`, `sbk`, `zr`, `faz`, `kjr`, `mjj`, `kms`, `ssm`).
- **Bulk students** sign in as `<section>.<nn>@baiust.ac.bd`: `cse1ia`, `cse1ib`, `cse2ia`,
  `cse3ia`, `bba1ia`, `bba1ib`, `bba2ia`, `bba3iia`, `eee1ia`, `eee2ia`, `civ1ia`, `civ2ia`,
  `law1ia`, `law2ia`, `eng1ia`, `eng2ia`, with `nn` from `01` (for example
  `cse2ia.07@baiust.ac.bd`). They are all active and accepted in that section.

## What is in it

- **Organisation:** six departments, each with exactly one active department admin: CSE, BBA, EEE,
  Civil (CIV), Law (LAW) and English (ENG), plus a retired one (ARCH). CSE and BBA have 4 sections
  each; EEE, CIV, LAW and ENG have 2 each (1-I-A and 2-I-A). Every section has 25 or more
  students, a CR and a DCR (except CSE 3-I-A and BBA 3-II-A), and every department has at least 5
  active teachers, one teacher waiting for approval and one join request waiting. A current semester, an archived one (with the
  previous-term sections CRs remind from) and a draft one (for the rollover checklist). A second
  allowed email domain.
- **Routine:** a full Sunday-Thursday week for every section with no section, room or teacher
  clashes, lab groups (G1/G2), a CSE course taught to a BBA section, a cancelled class next Sunday
  in CSE 1-I-A and BBA 1-I-A, and calendar events (holidays, CSE midterm, early closing, tech fest,
  BBA career fair), all dated relative to today.
- **Imports:** CSE has a published clean import (plus a replaced one). BBA has a failed import and
  an open one with 1 error, 2 warnings and a cross-department duplicate naming CSE.
- **Rooms and bookings:** 14 rooms (one retired, two aliases, CSE-201 shared with BBA). Requests in
  every status: pending, approved (with room locks), rejected, cancelled, a late cancel, expired, a
  no-show note, last week's bookings, and the two results of an approval (a request rejected as
  "room given to another" and one cancelled as "another request approved"). Bookings sit in this
  week and next, in the afternoon periods that classes do not use.
- **Join requests:** pending, escalated, rejected, rejected with an open appeal, withdrawn and
  revoked.
- **CR tools:** open, fixed and rejected flags; a DCR at today's flag limit; a reminder already
  sent today.
- **Chat:** six section groups and five one-to-one chats over nine days, unread messages, a deleted
  message, a removed member who appealed, a block, an open report (its messages held), a closed
  report with a suspension, and a lifted suspension.
- **Audit log:** more than 50 entries per department (so the list pages), plus university-wide
  ones, matching the data above. Entries are only ever inserted.
- Email and phone are stored only encrypted; some accounts have a phone, so you can check it never
  shows outside the owner's own profile.

## Demo accounts

| Email | Role | State | Try | Should be refused |
| --- | --- | --- | --- | --- |
| (your super admin) | super admin | active | Departments (one retired), admins, semesters (draft, current, archived), any department's dashboard and audit log | Removing the last super admin |
| `super.admin2@baiust.ac.bd` | second super admin | active | Same as above; removing one of the two (never the last) | Removing the last super admin |
| `cse.admin@baiust.ac.bd` | dept admin, CSE | active | Dashboard cards (registration, escalated request, flags, appeals, unconfirmed students, recent activity), audit log page 2, flags, appeals, chat reports, students, classrooms, rollover readiness | BBA rosters, BBA dashboard, BBA audit entries |
| `bba.admin@baiust.ac.bd` | dept admin, BBA | active | The open import with an error, a pending teacher registration, BBA requests and flags | Publishing the import with an error; any CSE data |
| `eee.admin@`, `civ.admin@`, `law.admin@`, `eng.admin@baiust.ac.bd` | dept admin, EEE / Civil / Law / English | active | Each department's dashboard, teacher queue, join requests, students and routine | Any other department's data |
| `<dept>.t1@` to `<dept>.t5@baiust.ac.bd` (`eee`, `civ`, `law`, `eng`) | teachers | active | Their department's routine and students | Other departments' sections |
| `<dept>.pending.t@baiust.ac.bd` and `<dept>.join@baiust.ac.bd` | teacher / student | pending / claim_pending | The waiting screens and the admin queues | Every app screen |
| `eee.former.admin@baiust.ac.bd` | former EEE admin | deactivated | - | Sign-in (account disabled) |
| `rahman.t@baiust.ac.bd` | teacher, CSE | active | Routine (1-I-A, 1-I-B), rosters of sections he teaches, his room requests, chat | The roster of 2-I-A (he does not teach it) |
| `tanjila.t@baiust.ac.bd` | teacher, CSE | active | 2-I-A and 3-I-A routine, an approved booking next week | Requests for 1-I-A |
| `zahid.t@baiust.ac.bd` | teacher, CSE | active | An empty routine and student list | Any room request (he teaches no section) |
| `hasan.t@baiust.ac.bd` | teacher, BBA | active | BBA routine and students, a chat with a BBA CR | Any CSE section |
| `nasir.t@baiust.ac.bd` | teacher, CSE | pending | The waiting-for-approval screen | Every app screen |
| `babul.t@baiust.ac.bd` | teacher, CSE | pending (registration rejected) | The registration-rejected screen with its reason | Every app screen |
| `suspended.t@baiust.ac.bd` | teacher, CSE | suspended | - | Sign-in (account disabled) |
| `selina.t@baiust.ac.bd` | teacher, CSE | deactivated | - | Sign-in (account disabled) |
| `unverified.t@baiust.ac.bd` | teacher | email_unverified | The verify-email screen | Everything else |
| `cr.a@baiust.ac.bd` | CR, CSE 1-I-A | active | CR page: 3 join requests (accept, reject, set group), rejected requests, roster, flags; group chat owner; room requests | Another section's CR page, roster or requests |
| `dcr.a@baiust.ac.bd` | DCR, CSE 1-I-A | active | Five flags raised today | A sixth flag today (limit 5) |
| `b1.student@baiust.ac.bd` | CR, CSE 1-I-B | active | Three pending requests for the same time | A fourth overlapping request (limit 3) |
| `cse2ia.01@baiust.ac.bd` | CR, CSE 2-I-A | active | Unconfirmed students from last semester's 1-II-A; a reminder already sent | A second reminder to Shuvo Roy today |
| `bba1.student@baiust.ac.bd` | CR, BBA 1-I-A | active | A pending join request, BBA requests (one in the shared CSE-201), the BBA group | Any CSE section |
| `a1.student@baiust.ac.bd` | student, CSE 1-I-A | active | Dashboard, routine, free rooms, chat (unread message to a teacher), own profile with email and phone | Admin pages; other sections' rosters |
| `a3.student@baiust.ac.bd` | student, CSE 1-I-A | active, chat-suspended | Reading chat | Sending any message (suspended for 4 more days) |
| `a4.student@baiust.ac.bd` | student, CSE 1-I-A | active | Blocked people (she blocked Imran Khan) | - |
| `a5.student@baiust.ac.bd` | student, CSE 1-I-A | active | His earlier chat with Nusrat | Messaging Nusrat Sultana (she blocked him) |
| `a6.student@baiust.ac.bd` | student, CSE 1-I-A | active | Her appeal against removal from the group | Posting in the 1-I-A group |
| `temp.password@baiust.ac.bd` | student, CSE 1-I-A | active, temporary password | The forced change-password screen | Everything else until the password is changed |
| `bouncing@baiust.ac.bd` | student, CSE 1-I-A | active, email bouncing | The "email bouncing" reminder | - |
| `join.student@baiust.ac.bd` | student | claim_pending | The waiting screen for 1-I-A; withdraw the request | Routine, rooms, the section group |
| `escalated.student@baiust.ac.bd` | student | claim_pending | A request the CR did not answer, now with the admin | - |
| `appeal.student@baiust.ac.bd` | student | claim_pending | The join form with a rejected request and its open appeal | A second appeal |
| `rejected.student@baiust.ac.bd` | student | claim_pending | The join form with the rejection reason; appeal it or ask again | Routine, rooms, the section group |
| `withdrawn.student@baiust.ac.bd`, `revoked.student@baiust.ac.bd` | student | claim_pending | A withdrawn request; a removal from 1-I-B with a reason | - |
| `unconfirmed.student@baiust.ac.bd` | student | unconfirmed | The semester-update screen | App screens until confirmed |
| `unconfirmed2.student@baiust.ac.bd` | student | unconfirmed | The waiting screen (asked to join 2-I-A) | - |
| `not.enrolled@baiust.ac.bd` | student | unconfirmed (not enrolled) | Already chose "not enrolled" | Being listed or reminded by a CR |
| `graduated.student@baiust.ac.bd` | student | graduated | A limited dashboard; chat still works | Join and room requests |
| `deactivated.student@baiust.ac.bd` | student | deactivated | - | Sign-in (account disabled) |
| `unverified.student@baiust.ac.bd` | student | email_unverified | The verify-email screen | Everything else |

## Things to know

- **Release R1.** `CURRENT_RELEASE` in `shared/features.js` is `R1`. Room requests are R2 and chat
  is R3, so at R1 the room-request queue says "not released", the CR and teacher request buttons
  are hidden, and the Chat link is not in the menu (`/chat` still opens if you type it). The data
  is there for when those releases are switched on.
- **Fridays and Saturdays** have no classes, so "today's classes" and live status are empty on
  those days. Pick another date on the free-rooms screen.
- **Dates move with "now".** Bookings, flags, reminders and cancellations are dated relative to the
  day you run the script. Running it again on a later day adds that day's set next to the old one.
- **The "unconfirmed after 14 days" card** fills only when the script created the current semester
  (it sets it current 15 days ago). An existing current semester is reused unchanged.
- **Not seeded:** profile photos and chat files (they must pass the ClamAV scan, so they are
  uploaded by hand), the email queue (`email_batch`, `email_dedupe`: fake rows would block or send
  real mail), sessions, tokens and job records (they appear as you use the app).
