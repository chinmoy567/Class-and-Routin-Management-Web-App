# 10: Join requests and UV ID claims

R1 · Status: Draft · Depends on: 09 · PRD: Student ID claim, Account states and access, Sessional groups (How a student's group is decided, Edge cases), CR/DCR dashboard (Act, Rules, Checks on CR power), Acceptance criteria (Account states, UV ID claims) · Diagrams: 09-activity-student-onboarding, 15-seq-join-request, 20-state-join-request

## Goal

A student joins a section for the current semester by sending a join request. Their first request also claims their UV ID. The section's CR or DCR accepts (setting the sessional group), rejects with a reason, or corrects the group. First action wins. Unanswered requests move to the department admin after 3 days.

## Scope

**In:** the join form, UV ID normalisation and duplicate rules, the CR/DCR decision, the group and later group changes, escalation, rejection limits, revoking a wrong claim, appeals, withdrawing a request, the waiting screen data.

**Out:** the semester-update screen around the same form (spec 14), the CR/DCR dashboard layout (spec 17), adding to the section group chat (spec 20 hook).

## Requirements

### The join form
- **JR-01** A `claim_pending` or `unconfirmed` student can send a join request with: full name (first request only; later it comes from the profile), UV ID (first request only, or until a claim is approved), department, level, term and section (chosen from **open** sections of the current semester, spec 09), and optionally a sessional group from that section's groups. Phone and photo are optional profile fields (spec 02).
- **JR-02** A student has at most one `pending` request at a time (`409 REQUEST_ALREADY_OPEN`). They can withdraw it and send another.
- **JR-03** If the current semester's sections for a department aren't open yet, the form shows "Your department is still setting up this semester" for that department.
- **JR-04** An `active` student can't send a join request (`STATE_NOT_ALLOWED`): their group is changed by the CR/DCR, and their section by a flag to the admin.

### UV ID
- **JR-05** The UV ID is stored as text with spaces and dashes removed and leading zeros kept (`uv_id_text`). For duplicate checks only, `uv_id_norm` also has the leading zeros removed (`0822310205101077` and `822310205101077` are the same ID). It must be 1–20 digits after cleaning.
- **JR-06** If the UV ID is already **approved** for another account, the request is refused (`409 UV_ID_TAKEN`) and the admin of the chosen department is notified. A pending claim never reserves an ID.
- **JR-07** If several pending claims name the same `uv_id_norm`, each shows a "duplicate pending claim" badge to the CR, DCR and admin.
- **JR-08** A student whose claims have been rejected 5 times can't claim again for 24 hours from the 5th rejection (`429 CLAIM_BLOCKED` with the time it ends). After the block the count starts again.

### Deciding
- **JR-09** The CR and DCRs of the chosen section see each pending request with the student's name, **email** (the allowed privacy exception), photo, UV ID (with a duplicate badge if any), department, level, term, section and requested group.
- **JR-10** They can **accept** (optionally with a corrected group, from the section's groups) or **reject** (reason 5–500 characters). The decision is a conditional update on `status: 'pending'`, and the second decider gets `409 ALREADY_DECIDED`.
- **JR-11** Accepting runs in one transaction: the request becomes `accepted`, the student's enrolment for the semester is accepted with the section and group (partial unique: one accepted per user per semester), the student becomes `active`, the profile is stamped "confirmed for <semester>", and, if the request carried a UV ID, the claim is approved and every other pending claim with the same `uv_id_norm` is rejected with the reason "ID approved for another account" (and the admin is notified). After commit: the student is emailed, and the hooks run to add them to the section group (spec 20) and clear their routine cache.
- **JR-12** Rejecting keeps the student `claim_pending` (or `unconfirmed`), emails them the reason, and adds the rejection to the admin's "rejected join requests" list.
- **JR-13** Every claim, decision, revocation, group change and appeal is audited.

### Escalation
- **JR-14** A request with no decision 3 days (72 hours) after it was sent is **escalated**: the CR/DCR can no longer decide it, and it appears in the admin's "ID claims that need the admin" card and digest. The admin decides it as in JR-10/11.
- **JR-15** If a section loses its last CR (spec 09 CRD-08), its pending requests are escalated at once.

### Groups
- **JR-16** The CR or DCR can change the group of any accepted student in their section at any time during the semester (or clear it). The change is audited and the student is emailed. It triggers `routine.changed` for that student.
- **JR-17** The admin of the department can set a student's group by hand. An admin override is stored with `group_set_by: 'admin'` and audited.
- **JR-18** A CR or DCR's own UV ID claim (spec 09 Decision) goes straight to the department admin, never to themselves.

### Revocation and appeals
- **JR-19** The admin can **revoke** an approved UV ID claim (for example "someone took my UV ID", after checking in person). The claim becomes `revoked`, that account's current enrolment becomes `revoked`, and the account goes back to `claim_pending`. The real owner can then claim the ID. Reason required, audited.
- **JR-20** A rejected student can **appeal** with one tap (once per rejection). The admin sees appeals and can reverse the decision by accepting the request (JR-11 runs as the admin) or confirm the rejection.

### Waiting screen
- **JR-21** `GET /api/me/join-request` returns the student's latest request with status, section, reason if rejected, and the CR/DCR card of the section (name, photo, role) so they can message them once chat ships.

## Permissions

| Action | Who | States |
|---|---|---|
| Send / withdraw a join request | the student | `claim_pending`, `unconfirmed` |
| View and decide pending requests of section S | CR/DCR of S (in effect); admin of S's dept (any, including escalated) | n/a |
| Decide escalated requests | admin of S's dept | n/a |
| Change group in S | CR/DCR of S; admin of S's dept | n/a |
| Revoke a claim, decide appeals | admin of the dept | n/a |
| Appeal | the rejected student | any that can sign in |

## Data

- `enrolment` (the join request **and** the membership): user_id, semester_id, section_id, group_id?, group_set_by? (`cr` | `admin`), status (`pending` | `accepted` | `rejected` | `withdrawn` | `revoked`), escalated_at?, uv_claim_id?, reason?, decided_by?, decided_at?, appeal { at, status: `open` | `upheld` | `reversed` }?, created_at. Indexes: partial unique `{ user_id, semester_id }` where `status: 'accepted'`, partial unique `{ user_id }` where `status: 'pending'`, `{ section_id, status, created_at }`.
- `uv_claim`: user_id, uv_id_text, uv_id_norm, status (`pending` | `approved` | `rejected` | `revoked`), decided_by?, decided_at?, reason?. Partial unique `{ uv_id_norm }` where `status: 'approved'`. Index `{ uv_id_norm, status }`.
- `user.claim_rejections` { count, blocked_until? } for JR-08.
- `user.confirmed_semester_id` for the profile stamp.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/join/options` | `claim_pending` / `unconfirmed` | none | open sections by department, with groups; departments still setting up | none |
| `POST /api/enrolments` | student | full_name?, uv_id?, section_id, group_id? | 201 | `REQUEST_ALREADY_OPEN`, `UV_ID_TAKEN`, `CLAIM_BLOCKED`, `SECTION_CLOSED`, `STATE_NOT_ALLOWED` |
| `POST /api/enrolments/:id/withdraw` | the student | none | 200 | `ALREADY_DECIDED` |
| `GET /api/me/join-request` | student | none | latest request + CR/DCR card | none |
| `GET /api/sections/:id/join-requests?status=pending` | CR/DCR of section, admin | none | list (with email, duplicate badges) | `NOT_FOUND` |
| `POST /api/enrolments/:id/decision` | CR/DCR of section (not escalated), admin | decision, group_id?, reason? | 200 | `ALREADY_DECIDED`, `VALIDATION_ERROR` |
| `PATCH /api/enrolments/:id/group` | CR/DCR of section, admin | group_id (or null) | 200 | `NOT_FOUND` |
| `POST /api/enrolments/:id/appeal` | the rejected student | none | 200 | `CONFLICT` (already appealed) |
| `POST /api/admin/enrolments/:id/appeal-decision` | admin | decision (`uphold` / `reverse`), group_id? | 200 | `ALREADY_DECIDED` |
| `POST /api/admin/uv-claims/:id/revoke` | admin | reason | 200 | none |
| `POST /api/me/uv-claim` | CR/DCR without an approved claim | uv_id | 201 | `UV_ID_TAKEN` |

## Jobs and events

- `join.escalate`: runs every 15 minutes and escalates requests older than 72 hours (idempotent).
- Emails: `join_accepted`, `join_rejected`, `group_changed`, `uv_id_conflict` (to admin).
- Hooks after accept: section group membership (spec 20), routine cache clear, `routine.changed` to `user:<id>`.

## Screens

Join form (with "department still setting up" state), Waiting screen (status, CR/DCR card, withdraw, appeal after rejection), Join requests list on the CR/DCR dashboard (spec 17) and the admin "need the admin" list (spec 18), group change control on the roster.

## Acceptance tests

- [PRD] Given a `claim_pending` student, when they open My routine, the free-room view or the section group, then the server refuses (403) and the page shows the waiting screen.
- [PRD] Given student A's pending claim for `0822310205101077`, when student B claims `822310205101077`, then both claims are pending with a "duplicate pending claim" badge.
- [PRD] When the CR accepts A's claim, then B's claim is rejected automatically and the admin is told.
- JR-06: claiming an ID approved for another account → `UV_ID_TAKEN`, and the admin is notified.
- JR-08: after the 5th rejection, a new request → `CLAIM_BLOCKED`. 24 hours later it is allowed.
- JR-10: CR and DCR accept the same request at the same moment → one `200`, one `ALREADY_DECIDED`.
- JR-11: accepting with a corrected group stores the corrected group, and the student sees that group's labs.
- JR-14: a request with no decision after 72 hours is escalated, and the CR deciding it gets `403`.
- JR-19: after revocation the wrong account is `claim_pending` and the real owner's claim can be approved.
- A CR of 2-II-A listing 2-II-B's requests → `404`.

## Decisions and open questions

- **Decision:** one `enrolment` document is both the join request and, once accepted, the membership. This matches the PRD's `enrolment` collection and gives one-accepted-per-semester through one partial index.
- **Decision:** after escalation, only the admin can decide (the PRD says the claim "moves to" the admin).
- **Decision:** the 5-rejection block counts all rejections since the last block ended.

## Tasks

- [ ] `enrolment`, `uv_claim` models + indexes; UV ID normaliser (unit-tested)
- [ ] Join options endpoint (open sections, setting-up departments)
- [ ] Create, withdraw, my-request endpoints with all checks
- [ ] Decision transaction (accept/reject) incl. claim approval and auto-rejection of duplicates
- [ ] Escalation job
- [ ] Group change (CR/DCR, admin override)
- [ ] Revoke + appeals
- [ ] CR/DCR own-claim path to admin
- [ ] Emails, audit, hooks
- [ ] Join form + waiting screen
- [ ] Tests incl. the PRD acceptance criteria
