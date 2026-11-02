# Plan: 10 Join requests and UV ID claims

Spec: `.claude/specs/10-join-requests.md`. Depends on 09 (built). Diagrams read: `09-activity-student-onboarding`, `15-seq-join-request`, `20-state-join-request`. No PRD open question blocks this spec. The user asked for an unattended run, so the choices under "Assumptions" are the safest minimal readings.

## Goal

A `claim_pending` or `unconfirmed` student sends one join request to an open section of the current semester. The first request also claims a UV ID. The section's CR or DCR accepts (optionally correcting the group) or rejects with a reason. First action wins. After 72 hours the request is escalated and only the department admin can decide it. The CR/DCR or admin can change an accepted student's group. The admin can revoke a wrong claim and decide appeals. Rejected students see a waiting screen with the CR/DCR card.

## Rules and acceptance criteria

1. JR-01 Create request (`claim_pending`/`unconfirmed`): full name (first request only), UV ID (until a claim is approved), open section, optional group of that section.
2. JR-02 One pending request per student (`409 REQUEST_ALREADY_OPEN`); withdraw, then send another.
3. JR-03 Options endpoint lists departments still setting up (no open section).
4. JR-04 `active` student → `STATE_NOT_ALLOWED`.
5. JR-05 `uv_id_text` (spaces/dashes removed, zeros kept), `uv_id_norm` (zeros stripped), 1–20 digits.
6. JR-06 UV ID approved for another account → `409 UV_ID_TAKEN`, admin of the chosen department notified. A pending claim reserves nothing.
7. JR-07 Duplicate pending claims get a `duplicate_pending_claim` badge.
8. JR-08 5 rejections → `429 CLAIM_BLOCKED` with end time for 24 h; count restarts.
9. JR-09 CR/DCR list shows name, email (the privacy exception), photo, UV ID, dept, level, term, section, group.
10. JR-10 Accept/reject (reason 5–500) as a conditional update on `pending`; second decider gets `409 ALREADY_DECIDED`.
11. JR-11 Accept in one transaction: enrolment accepted with group, student `active`, profile stamped, claim approved, other pending claims of the same `uv_id_norm` rejected ("ID approved for another account", admin notified). After commit: email, hooks (group chat, routine cache), `routine.changed`.
12. JR-12 Reject: student stays waiting, emailed the reason, listed for the admin.
13. JR-13 Claim, decision, revocation, group change, appeal are audited.
14. JR-14 72 h → escalated; the CR/DCR gets 403; only the admin decides. JR-15 handled by spec 09 (`escalatePendingOfSection`); tested here.
15. JR-16 CR/DCR change an accepted student's group any time (or clear). Audited, emailed, `routine.changed`.
16. JR-17 Admin sets a group by hand, `group_set_by: 'admin'`.
17. JR-18 A CR/DCR's own claim goes to the admin only.
18. JR-19 Admin revokes an approved claim: claim `revoked`, current enrolment `revoked`, account back to `claim_pending`.
19. JR-20 One appeal per rejection; admin upholds or reverses (reverse runs JR-11 as admin).
20. JR-21 `GET /api/me/join-request` returns latest request and CR/DCR card.
21. [PRD] `claim_pending` student is refused (403) on routine/free-room/group routes and gets the waiting screen.
22. [PRD] Duplicate pending claims for `0822310205101077` and `822310205101077` both show the badge.
23. [PRD] CR accepts A → B's claim is auto-rejected and admin told.
24. A CR of one section listing another section's requests → `404`.
25. Account states follow the PRD table. Concurrency: CR+DCR accepting the same request → one 200, one `ALREADY_DECIDED`.

## Assumptions

- **Module layout.** `enrolments` (spec 09) keeps the `Enrolment` model and gains the `UvClaim` model plus low-level helpers. A new `join` module holds routes, policy, orchestration and the escalation job. This avoids an import cycle with `representatives`.
- **Admin cannot see emails.** The PRD Privacy rule allows email only for the CR/DCR on a join request. Admin lists omit it; the section list includes it only when the caller is a CR/DCR of that section.
- **404 vs 403.** A CR/DCR of another section gets 404; an admin of another department gets 403 (as in spec 08/09); a plain student gets 403.
- **Escalated + CR race.** A CR decision adds `escalated_at` missing to its conditional filter, so it loses to escalation (`ALREADY_DECIDED`).
- **Automatic rejection (duplicate claim) does not count toward the 5-rejection block.** Only a decider's rejection of a request carrying a claim counts. The block only applies to a request that carries a claim.
- **Withdrawing deletes the pending claim of that request** (it never reserved anything).
- **First request name.** `full_name` is applied only if the student has no earlier enrolment; otherwise ignored.
- **Admin decision on a CR/DCR's own claim (JR-18).** The spec lists no endpoint to decide it, so `POST /api/admin/uv-claims/:id/decision` and `GET /api/admin/join-requests` (escalated / rejected / appeals / claims) are added.
- **Accept sets `user.department_id`** to the section's department (department is known only at join).
- **`SECTION_CLOSED`, `REQUEST_ALREADY_OPEN`, `UV_ID_TAKEN`, `CLAIM_BLOCKED`** are added to `shared/errors.js` (409, 409, 409, 429).
- **Hooks.** `registerJoinAcceptedHook` for spec 20 (group chat) and the routine cache; no-ops until then.
- **Group in use (EDT-07).** `registerGroupUsage` gets a provider: a group with a pending or accepted enrolment is in use.

## Files

**shared/**: `schemas/join.js` (UV normaliser, bodies, params, queries), `errors.js`, `schemas/index.js`.

**server/src/modules/enrolments/**: `enrolment.model.js` (extended), `uvclaim.model.js`, `uv-id.js` (normaliser, re-export of shared), `enrolment.service.js` (helpers), `index.js`.

**server/src/modules/join/** (new): `join.policy.js`, `request.service.js` (options, create, withdraw, mine, own claim), `decision.service.js` (accept/reject/appeal/revoke/group), `list.service.js`, `join.jobs.js` (`join.escalate`), `hooks.js`, `join.controller.js`, `join.routes.js`, `index.js`, `__tests__/join.api.test.js`, `__tests__/uv-id.test.js`.

**server/src/modules/auth/**: `students.service.js` (`activateStudentForSemester` takes the department; `departmentAdminIds`; `userCard`; claim-block helpers), `auth.model.js` (`claim_rejections`), `index.js`.

**server/src/modules/routine/**: `section.brief.js` (`listGroups`, `getGroupBrief`), `index.js`.

**Other server files**: `app.js` (mount), `server.js` (job registrar and `every('15 minutes')`), `notifications/templates/index.js` and `i18n/en.json` (`join_accepted`, `join_rejected`, `group_changed`, `uv_id_conflict`), `test/harness.js` (model import), `__tests__/app.test.js` (error list).

**client/src/**: `features/join/{api.js,hooks.js}`, `routes/JoinPage.jsx`, `routes/WaitingPage.jsx`, `App.jsx`, `i18n/en.json`, `lib/query-keys.js`, `routes/__tests__/join.test.jsx`.

## Data model

- `enrolment`: adds `department_id`, `group_set_by`, `uv_claim_id`, `reason`, `appeal {at,status}`. Existing partial uniques kept.
- `uv_claim`: `user_id, department_id, uv_id_text, uv_id_norm, status, decided_by, decided_at, reason`. Partial unique `{uv_id_norm}` where `approved`; index `{uv_id_norm,status}`.
- `user.claim_rejections {count, blocked_until}`.
- Transactions: accept (enrolment, claim approval, auto-rejections, user state), revoke, create (claim + enrolment), reject (decision + counter).
- First action wins: `findOneAndUpdate({_id, status:'pending'})`; duplicate-key on the approved-claim index → `UV_ID_TAKEN`; on the accepted-enrolment index → `CONFLICT`.

## API

As in the spec table, plus `POST /api/admin/uv-claims/:id/decision` and `GET /api/admin/join-requests?department_id&view=`. All bodies/params/queries validated with Zod. `can()` actions: `join.request`, `join.view_own`, `join.decide`, `join.group`, `join.admin`, `join.claim_own`. Audit: `join.request`, `join.accept`, `join.reject`, `join.withdraw`, `join.group_change`, `join.appeal`, `join.appeal_decision`, `uv_claim.approve`, `uv_claim.reject`, `uv_claim.revoke`.

## UI

Join form (department → section → optional group; name and UV ID when needed; "department is still setting up" state), waiting screen (status, reason, CR/DCR card, withdraw, appeal). Texts under `join.*` in `en.json`. The CR dashboard list and admin cards stay in specs 17/18.

## Tests

Server API tests named `JR-xx …` for every item above, with cross-scope refusals (CR of another section, admin of another department, student, teacher), account-state tests and concurrency tests (CR+DCR accept together; two students claiming the same ID; one student sending two requests together). Unit tests for the UV ID normaliser. One client test for form and waiting screen.

## Build order

1. Shared schemas and errors, models, normaliser (unit-tested).
2. Options, create, withdraw, mine.
3. Decision (accept/reject), claim logic, emails, audit.
4. Escalation job, group change, revoke, appeals, own claim, admin list.
5. Client screens.
6. Run lint, tests, build; verify with `/verify-spec 10`.

## Out of scope

The semester-update screen (14), CR/DCR dashboard layout (17), admin dashboard cards (18), group chat membership (20).
