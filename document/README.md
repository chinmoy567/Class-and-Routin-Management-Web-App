# Class & Routine Management — Diagrams

All diagrams are drawn from `Class and Routine Management - PRD.md`.

- `src/` — Mermaid source (`.mmd`). Edit these files; they also render in GitHub and VS Code.
- `svg/` — vector output (sharp at any zoom; best for the big ER diagram).
- `png/` — image output for slides and reports.

To render again after editing (needs Node):

```bash
npx -p @mermaid-js/mermaid-cli mmdc -i src/05-er-diagram.mmd -o svg/05-er-diagram.svg -b white
```

## Index

| # | Diagram | Type | What it shows |
|---|---------|------|---------------|
| 01 | [Use case](svg/01-use-case.svg) | Use case | Actors (super admin, dept admin, teacher, student, CR/DCR, scheduler) and the features each one uses |
| 02 | [Role hierarchy](svg/02-role-hierarchy.svg) | Hierarchy | Who creates, approves or assigns whom |
| 03 | [System context](svg/03-system-context.svg) | C4 level 1 | The platform, its users, and outside services (email, malware scanner, push, Excel template) |
| 04 | [Architecture](svg/04-architecture.svg) | C4 level 2 | Client, server modules, data stores |
| 05 | [ER diagram](svg/05-er-diagram.svg) | Entity-relationship | Logical data model: tables, keys, relationships |
| 06 | [Class diagram](svg/06-class-diagram.svg) | UML class | Domain classes, role inheritance, main operations |
| 07 | [DFD level 0](svg/07-dfd-level0.svg) | Data flow | The system as one process |
| 08 | [DFD level 1](svg/08-dfd-level1.svg) | Data flow | 8 processes and 7 data stores |
| 09 | [Student onboarding](svg/09-activity-student-onboarding.svg) | Activity | Sign-up, email check, join form, CR/DCR decision, 3-day escalation |
| 10 | [Teacher approval](svg/10-activity-teacher-approval.svg) | Activity (swimlane) | Teacher registration, admin approval, short-code linking |
| 11 | [Room booking](svg/11-activity-room-booking.svg) | Activity | 12-hour rule, request window, 3-request limit, decision cutoff, cancellation |
| 12 | [Routine import](svg/12-activity-routine-import.svg) | Activity | Template upload, errors and warnings, preview, re-import diff, publish |
| 13 | [Semester rollover](svg/13-activity-semester-rollover.svg) | Activity | New semester, roles reset, students re-confirm, 14-day follow-up |
| 14 | [Live status](svg/14-activity-live-status.svg) | Activity | How "In class / Free" and the countdown are worked out each minute |
| 15 | [Join request](svg/15-seq-join-request.svg) | Sequence | Student submits, CR accepts, first action wins |
| 16 | [Room request](svg/16-seq-room-request.svg) | Sequence | Free-room query, request, approval, auto-expiry job |
| 17 | [Sign-in](svg/17-seq-auth-login.svg) | Sequence | Lockout, email verification, admin one-time code, routing by account state |
| 18 | [Chat message](svg/18-seq-chat-message.svg) | Sequence | Permission checks, file scan, realtime delivery, sent/delivered/seen |
| 19 | [Account lifecycle](svg/19-state-account.svg) | State | Teacher and student account states |
| 20 | [Join request states](svg/20-state-join-request.svg) | State | Pending, accepted, rejected, escalated, revoked |
| 21 | [Room request states](svg/21-state-room-request.svg) | State | Pending, approved, rejected, cancelled, expired, no-show |
| 22 | [Semester / section / chat / routine](svg/22-state-semester-section.svg) | State | Lifecycles tied to the semester |
| 23 | [Deployment](svg/23-deployment.svg) | Deployment | Suggested hosting setup |
| 24 | [Sitemap](svg/24-sitemap.svg) | Navigation | Pages each role reaches after sign-in |
| 25 | [Routine resolution](svg/25-routine-resolution.svg) | Flow | How a student's own routine is picked: level, term, section, then group |
| 26 | [CR / DCR assignment](svg/26-activity-cr-dcr-assignment.svg) | Activity | Re-appoint or pick leaders, one-CR / two-DCR limit, section opening, role removal |
| 27 | [Chat moderation](svg/27-activity-chat-moderation.svg) | Activity | Block, report routing, limited report view, chat suspension |
| 28 | [Free-room check](svg/28-activity-free-room-check.svg) | Activity | How the free-room view decides Free, In use or Booked for a date and slot |

Notes: diagrams 04, 05 and 23 describe a **proposed** technical design (for example PostgreSQL, Redis, WebSocket). The PRD does not fix a tech stack, so change them once the stack is chosen.
