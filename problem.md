

## 🟠 High: missing rules and gaps

14. **Room booking loopholes**
    - The CR and DCRs of one section can each send 3 requests, so 9 per slot, and two of them can win different rooms. The requester for CR/DCR requests should be the section, not the person.
    - Requests can span up to 3 hours, but auto-cancel only covers "the same date and time". It should cover overlapping times.
    - Rooms shared by several departments are decided by a super admin. That creates the bottleneck line 133 says the design avoids.
    - "Can cancel only until 6 hours before" makes no sense. Blocking a late cancel turns it into a no-show. Allow cancelling at any time.
    - An admin can approve 2 minutes before the slot starts. Add a decision cutoff, such as 2 hours before.
    - The booking diagram is outdated (line 406, flagged by the document itself).
15. **Holidays and calendar** (open question 10) are deferred, but status, countdown, free rooms and bookings all assume the routine always runs. Exam weeks, Ramadan timings and holidays will make live status wrong on day one. Make at least holiday dates and semester start/end dates P0.
16. **Graduation and account lifecycle** are never addressed. Level 4 Term II students become "unconfirmed" forever and clutter every admin list. Departing teachers, alumni, and account-deletion requests also need rules.
17. **Admin account recovery is missing.** Nothing covers an admin losing their password or second-factor device. The second factor itself is still undecided (open question 21), yet admin sign-in with it is P0.
18. **Name changes allow impersonation.** Students and teachers can edit their profile, and chat search shows the name. Someone can rename themselves "Dr. Arifur Rahaman" or "Admin". Lock the name after approval, or require re-approval to change it.
19. **CR removed mid-semester.** It's unclear what happens to pending join requests, whether a new section group gets created when a new CR is named, and whether the section closes if no DCR exists. "Created when the CR is named" needs to say "once per section per semester".
20. **Teachers who work in two departments.** Mentioned twice but never modelled. One email equals one account, so can one account link to `CSE:AR` and `CE:XY`?

---

## 🟡 Medium: security and technical details

21. **Email hash (line 599).** A plain hash of `name.cse1234@baiust.ac.bd` can be reversed by brute force, because the domain and pattern are known. Use HMAC with a secret key (pepper), not a plain hash.
22. **Hiding emails even from admins** is over-engineered and blocks support work, since admins can't even contact a teacher. University emails are usually in a public directory anyway. Recommend letting admins see emails, with each view audited.
23. **File uploads.** "Images" should mean PNG/JPG/WebP only. SVG can carry scripts. Legacy `.doc`/`.xls` can carry macros. Malware scanning needs a real service, which costs money and adds infrastructure. File downloads also need per-file permission checks so one user can't fetch another's file by guessing its ID.
24. **Password policy.** Composition rules (a letter plus a number) are outdated guidance. Modern guidance (NIST 800-63B) is 8 or more characters plus a check against known-breached passwords.
25. **Session timeout** is "a period of inactivity", with no number given.
26. **"Free now" student list.** Status is computed per section and group (line 592), so listing individual students adds privacy exposure and no information. Show "sections/groups free now" instead.
27. **Routine edits go live instantly** (line 503) with no draft step. Five edits in a row means five sets of notifications and students seeing half-edited states. Batch edits and publish them together.
28. **Re-import diff** (line 458) needs a stable identity for each routine row. That's harder to build than it sounds, so call it out as a technical risk.
29. **Sunday–Thursday and 8:30–5:30 are hard-coded.** Make the week and periods configurable per department.

---

## 🟡 Medium: what a real PRD still needs

- **Scale numbers:** how many students, teachers, departments and concurrent users. Without them, the "~2 seconds" performance targets mean nothing.
- **Success metrics or KPIs:** for example, "80% of students active by week 2" or "fewer than X routine complaints".
- **RPO and RTO** (how much data you can afford to lose, and how fast you must recover): daily backups mean losing up to 24 hours of chat.
- **Accessibility, supported browsers, and Bangla language support.**
- **Email deliverability:** SPF/DKIM setup and bounce webhooks. Bounce detection (line 69) depends on the mail provider.
- **Launch and migration plan, plus a support process.**
- **Scope realism.** Nearly everything is P0: real-time chat, file scanning, admin second factor, routine import and diffing, booking, three dashboards. For a small team that's several months of work. I'd cut chat and files to P1. WhatsApp already covers them, and line 14 says you don't want to replace it.

---

## ⚪ Document cleanup

- Line 303: two bullets merged into one: `…no student list or ID range is checked.- **Flag a problem…`
- Line 525: a stray `5.` numbered item inside a bulleted list, duplicating item 6 above it.
- Lines 41 and 527: conversational leftovers ("your '2 DCR' rule", "Your brief mentions…").
- Undefined terms: "UV ID", "batch". "Term" (2-II) and "semester" (Fall 2026) are used interchangeably in places (line 527). "Booking" and "request" are mixed.
- Line 5: the summary is one 90-word sentence. Break it up.
- Open questions: "Resolved" items are mixed in with open ones. Move resolved items into the body and keep only real open questions there.

---

**Top 5 to fix first:** #1 (rollover lockout), #2 (CR verification), #4 (bookings not showing in the routine), #5–7 (the contradictions), and cutting P0 scope.

*Line numbers refer to the PRD as it was when this audit was written.*
