# 10: Join requests

R1 · Status: Done · Depends on: 09 · PRD: Joining a section, Account states and access, Sessional groups (How a student's group is decided, Edge cases), CR/DCR dashboard (Act, Rules, Checks on CR power), Non-functional requirements (Privacy of the UV ID), Acceptance criteria (Account states, Sign-up and joining a section) · Diagrams: 09-activity-student-onboarding, 15-seq-join-request, 20-state-join-request

> Changed by spec 24 (open sign-up, no UV ID claim): the UV ID claim and all its rules are gone. The UV ID is an optional profile field (spec 02 PRF-10) shown to the deciders. JR-19 is now "remove a student from a section".

## Goal

A student joins a section for the current semester by sending a join request. The section's CR or DCR accepts (setting the sessional group), rejects with a reason, or corrects the group. First action wins. Unanswered requests move to the department admin after 3 days. The system never checks a university ID.

## Scope

**In:** the join form, the CR/DCR decision, the group and later group changes, escalation, removing a student from a section, appeals, withdrawing a request, the waiting screen data, showing the applicant's optional profile UV ID to the deciders.

**Out:** the semester-update screen around the same form (spec 14), the CR/DCR dashboard layout (spec 17), adding to the section group chat (spec 20 hook), editing the UV ID (spec 02).

## Requirements

### The join form
- **JR-01** A `claim_pending` or `unconfirmed` student can send a join request with: full name (first request only; later it comes from the profile), department, level, term and section (chosen from **open** sections of the current semester, spec 09), and optionally a sessional group from that section's groups. The form has **no UV ID**: a body containing `uv_id` (or any other unknown key) is `400 VALIDATION_ERROR`. Phone, photo and UV ID are optional profile fields (spec 02).
- **JR-02** A student has at most one `pending` request at a time (`409 REQUEST_ALREADY_OPEN`). They can withdraw it and send another.
- **JR-03** If the current semester's sections for a department aren't open yet, the form shows "Your department is still setting up this semester" for that department.
- **JR-04** An `active` student can't send a join request (`STATE_NOT_ALLOWED`): their group is changed by the CR/DCR, and their section by a flag to the admin.

### UV ID
- **JR-05** Removed by spec 24 (UV ID normalisation now lives on the profile, spec 02 PRF-10).
- **JR-06** Removed by spec 24 (no "already approved" check, no `UV_ID_TAKEN`).
- **JR-07** Removed by spec 24 (no duplicate-pending badge).
- **JR-08** Removed by spec 24 (no rejection block, no `CLAIM_BLOCKED`, no `user.claim_rejections`). Abuse is handled by JR-02, the sign-up and sign-in rate limits, and the admin deactivating the account.

### Deciding
- **JR-09** The CR and DCRs of the chosen section see each pending request with the student's name, **email** (the allowed privacy exception), photo, the UV ID from the student's profile (or none), department, level, term, section and requested group. The UV ID is never checked and never shown to anyone outside the PRD's Privacy of the UV ID rule.
- **JR-10** They can **accept** (optionally with a corrected group, from the section's groups) or **reject** (reason 5–500 characters). The decision is a conditional update on `status: 'pending'`, and the second decider gets `409 ALREADY_DECIDED`.
- **JR-11** Accepting runs in one transaction: the request becomes `accepted`, the student's enrolment for the semester is accepted with the section and group (partial unique: one accepted per user per semester), the student becomes `active`, and the profile is stamped "confirmed for <semester>". After commit: the student is emailed, and the hooks run to add them to the section group (spec 20) and clear their routine cache.
- **JR-12** Rejecting keeps the student `claim_pending` (or `unconfirmed`), emails them the reason, and adds the rejection to the admin's "rejected join requests" list. There is no limit on the number of rejections.
- **JR-13** Every request, decision, removal from a section, group change and appeal is audited.

### Escalation
- **JR-14** A request with no decision 3 days (72 hours) after it was sent is **escalated**: the CR/DCR can no longer decide it, and it appears in the admin's "join requests that need the admin" card and digest. The admin decides it as in JR-10/11.
- **JR-15** If a section loses its last CR (spec 09 CRD-08), its pending requests are escalated at once.

### Groups
- **JR-16** The CR or DCR can change the group of any accepted student in their section at any time during the semester (or clear it). The change is audited and the student is emailed. It triggers `routine.changed` for that student.
- **JR-17** The admin of the department can set a student's group by hand. An admin override is stored with `group_set_by: 'admin'` and audited.
- **JR-18** A join request from a student who holds a CR or DCR role in effect goes straight to the department admin: it is escalated when it is created, so no CR or DCR decides their own request.

### Removal and appeals
- **JR-19** The admin of the section's department can **remove a student from a section**: the student's accepted enrolment in the current semester becomes `revoked`, and the account goes back to `claim_pending`, so the student can send a new join request. A reason (5–500 characters) is required, and the action is audited (`join.remove`). After commit, `routine.changed` is pushed to the student and the membership-removed hooks run (spec 20 removes them from the section group). An admin of another department gets `403`. It replaces the old "revoke a UV ID claim".
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
| Remove a student from S, decide appeals | admin of S's dept | n/a |
| Appeal | the rejected student | any that can sign in |

## Data

- `enrolment` (the join request **and** the membership): user_id, semester_id, section_id, group_id?, group_set_by? (`cr` | `admin`), status (`pending` | `accepted` | `rejected` | `withdrawn` | `revoked`), escalated_at?, reason?, decided_by?, decided_at?, appeal { at, status: `open` | `upheld` | `reversed` }?, created_at. Indexes: partial unique `{ user_id, semester_id }` where `status: 'accepted'`, partial unique `{ user_id }` where `status: 'pending'`, `{ section_id, status, created_at }`.
- `user.uv_id?` (spec 02 PRF-10) is read for the request lists and rosters. It is not unique and has no index rule.
- `user.confirmed_semester_id` for the profile stamp.
- The `uv_claim` collection, `enrolment.uv_claim_id` and `user.claim_rejections` are removed (spec 24; one-off script `server/scripts/migrate-drop-uv-claims.js`).

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/join/options` | `claim_pending` / `unconfirmed` | none | open sections by department, with groups; departments still setting up | none |
| `POST /api/enrolments` | student | full_name?, section_id, group_id? | 201 | `VALIDATION_ERROR` (including a `uv_id` key), `REQUEST_ALREADY_OPEN`, `SECTION_CLOSED`, `STATE_NOT_ALLOWED` |
| `POST /api/enrolments/:id/withdraw` | the student | none | 200 | `ALREADY_DECIDED` |
| `GET /api/me/join-request` | student | none | latest request + CR/DCR card | none |
| `GET /api/sections/:id/join-requests?status=pending` | CR/DCR of section, admin | none | list (with email for the CR/DCR, and `uv_id` from the profile) | `NOT_FOUND` |
| `POST /api/enrolments/:id/decision` | CR/DCR of section (not escalated), admin | decision, group_id?, reason? | 200 | `ALREADY_DECIDED`, `VALIDATION_ERROR` |
| `PATCH /api/enrolments/:id/group` | CR/DCR of section, admin | group_id (or null) | 200 | `NOT_FOUND` |
| `POST /api/enrolments/:id/appeal` | the rejected student | none | 200 | `CONFLICT` (already appealed) |
| `POST /api/admin/enrolments/:id/appeal-decision` | admin | decision (`uphold` / `reverse`), group_id? | 200 | `ALREADY_DECIDED` |
| `POST /api/admin/enrolments/:id/remove` | admin of the section's dept | reason | 200 | `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` (not a current member), `VALIDATION_ERROR` |
| `GET /api/admin/join-requests?view=escalated\|rejected\|appeals` | admin | none | list (with `uv_id`, no email) | `FORBIDDEN` |

`POST /api/me/uv-claim`, `POST /api/admin/uv-claims/:id/revoke` and `POST /api/admin/uv-claims/:id/decision` are removed (spec 24) and return `404`.

## Jobs and events

- `join.escalate`: runs every 15 minutes and escalates requests older than 72 hours (idempotent).
- Emails: `join_accepted`, `join_rejected`, `group_changed`.
- Hooks after accept: section group membership (spec 20), routine cache clear, `routine.changed` to `user:<id>`.
- Hooks after removal from a section (JR-19): section group membership removal (spec 20), `routine.changed` to `user:<id>`.

## Screens

Join form (with "department still setting up" state; no UV ID input), Waiting screen (status, CR/DCR card, withdraw, appeal after rejection), Join requests list on the CR/DCR dashboard (spec 17) and the admin "need the admin" list (spec 18), group change control on the roster, "remove from section" on the admin student screen (spec 18).

## Acceptance tests

- [PRD] Given a `claim_pending` student, when they open My routine, the free-room view or the section group, then the server refuses (403) and the page shows the waiting screen.
- [PRD] A join request that contains `uv_id` → `400 VALIDATION_ERROR`.
- [PRD] CR and DCR decide the same request at the same moment → one `200`, one `ALREADY_DECIDED`.
- JR-09: the CR of 2-II-A sees the `uv_id` from the applicant's profile on a 2-II-A request, and gets `404` listing 2-II-B's requests.
- JR-11: accepting with a corrected group stores the corrected group, and the student sees that group's labs.
- JR-12: after six rejections the student can still send a new request.
- JR-14: a request with no decision after 72 hours is escalated, and the CR deciding it gets `403`.
- JR-18: a request from a student with a CR role in effect is escalated at once.
- JR-19: after removal the enrolment is `revoked`, the student is `claim_pending` and can send a new request; an admin of another department gets `403`; it is audited.
- The removed claim routes return `404`.

## Decisions and open questions

- **Decision:** one `enrolment` document is both the join request and, once accepted, the membership. This matches the PRD's `enrolment` collection and gives one-accepted-per-semester through one partial index.
- **Decision:** after escalation, only the admin can decide (the PRD says the request "moves to" the admin).
- **Decision (spec 24):** the state name `claim_pending` is kept; it means "verified, no accepted join request".

## Tasks

- [x] `enrolment` model + indexes
- [x] Join options endpoint (open sections, setting-up departments)
- [x] Create, withdraw, my-request endpoints with all checks
- [x] Decision transaction (accept/reject)
- [x] Escalation job
- [x] Group change (CR/DCR, admin override)
- [x] Appeals
- [x] Emails, audit, hooks
- [x] Join form + waiting screen
- [x] Tests incl. the PRD acceptance criteria
- [x] Spec 24: claim code removed (`uv_claim`, own-claim and revoke routes, rejection block); profile `uv_id` in the lists; CR/DCR own request escalated at once; admin "remove from section" (JR-19)
