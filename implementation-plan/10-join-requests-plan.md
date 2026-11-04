# Plan: 10 Join requests

> Updated for spec 24 (open sign-up, no UV ID claim): the claim, its model, routes, rules and tests were removed. JR-05 to JR-08 are removed, JR-18 is a CR/DCR's own join request (escalated at once), and JR-19 is the admin's "remove a student from a section". See `implementation-plan/24-open-signup-no-id-plan.md`.

Spec: `.claude/specs/10-join-requests.md`. Depends on 09 (built). Diagrams read: `09-activity-student-onboarding`, `15-seq-join-request`, `20-state-join-request`. No PRD open question blocks this spec. The user asked for an unattended run, so the choices under "Assumptions" are the safest minimal readings.

## Goal

A `claim_pending` or `unconfirmed` student sends one join request to an open section of the current semester. The section's CR or DCR accepts (optionally correcting the group) or rejects with a reason. First action wins. After 72 hours the request is escalated and only the department admin can decide it. The CR/DCR or admin can change an accepted student's group. The admin can remove a student from a section and decide appeals. Rejected students see a waiting screen with the CR/DCR card.

## Rules and acceptance criteria

1. JR-01 Create request (`claim_pending`/`unconfirmed`): full name (first request only), open section, optional group of that section. A `uv_id` key → `400 VALIDATION_ERROR` (strict schema).
2. JR-02 One pending request per student (`409 REQUEST_ALREADY_OPEN`); withdraw, then send another.
3. JR-03 Options endpoint lists departments still setting up (no open section).
4. JR-04 `active` student → `STATE_NOT_ALLOWED`.
5. JR-05 to JR-08 removed by spec 24.
9. JR-09 CR/DCR list shows name, email (the privacy exception), photo, the profile UV ID (or null), dept, level, term, section, group.
10. JR-10 Accept/reject (reason 5–500) as a conditional update on `pending`; second decider gets `409 ALREADY_DECIDED`.
11. JR-11 Accept in one transaction: enrolment accepted with group, student `active`, profile stamped. After commit: email, hooks (group chat, routine cache), `routine.changed`.
12. JR-12 Reject: student stays waiting, emailed the reason, listed for the admin. No rejection limit.
13. JR-13 Request, decision, removal from a section, group change, appeal are audited.
14. JR-14 72 h → escalated; the CR/DCR gets 403; only the admin decides. JR-15 handled by spec 09 (`escalatePendingOfSection`); tested here.
15. JR-16 CR/DCR change an accepted student's group any time (or clear). Audited, emailed, `routine.changed`.
16. JR-17 Admin sets a group by hand, `group_set_by: 'admin'`.
17. JR-18 A request from a student with a CR/DCR role in effect is created already escalated, so only the admin decides it.
18. JR-19 Admin of the department removes a student from a section (`POST /api/admin/enrolments/:id/remove`, reason): current accepted enrolment `revoked`, account back to `claim_pending`, audited `join.remove`, `routine.changed` and membership-removed hooks after commit. Another department's admin → 403.
19. JR-20 One appeal per rejection; admin upholds or reverses (reverse runs JR-11 as admin).
20. JR-21 `GET /api/me/join-request` returns latest request and CR/DCR card.
21. [PRD] `claim_pending` student is refused (403) on routine/free-room/group routes and gets the waiting screen.
22. [PRD] A join request with a `uv_id` → `VALIDATION_ERROR`.
23. [PRD] An admin of another department removing a student → 403.
24. A CR of one section listing another section's requests → `404`.
25. Account states follow the PRD table. Concurrency: CR+DCR accepting the same request → one 200, one `ALREADY_DECIDED`.

## Assumptions

- **Module layout.** `enrolments` (spec 09) keeps the `Enrolment` model plus low-level helpers. A new `join` module holds routes, policy, orchestration and the escalation job. This avoids an import cycle with `representatives`.
- **Admin cannot see emails.** The PRD Privacy rule allows email only for the CR/DCR on a join request. Admin lists omit it; the section list includes it only when the caller is a CR/DCR of that section.
- **404 vs 403.** A CR/DCR of another section gets 404; an admin of another department gets 403 (as in spec 08/09); a plain student gets 403.
- **Escalated + CR race.** A CR decision adds `escalated_at` missing to its conditional filter, so it loses to escalation (`ALREADY_DECIDED`).
- **First request name.** `full_name` is applied only if the student has no earlier enrolment; otherwise ignored.
- **Admin lists.** `GET /api/admin/join-requests` (escalated / rejected / appeals) is added.
- **Accept sets `user.department_id`** to the section's department (department is known only at join).
- **`SECTION_CLOSED`, `REQUEST_ALREADY_OPEN`** are added to `shared/errors.js` (409, 409).
- **Hooks.** `registerJoinAcceptedHook` and `registerMembershipRemovedHook` for spec 20 (group chat) and the routine cache; no-ops until then.
- **Group in use (EDT-07).** `registerGroupUsage` gets a provider: a group with a pending or accepted enrolment is in use.

## Files

**shared/**: `schemas/join.js` (bodies, params, queries), `errors.js`, `schemas/index.js`.

**server/src/modules/enrolments/**: `enrolment.model.js` (extended), `enrolment.service.js` (helpers), `index.js`.

**server/src/modules/join/** (new): `join.policy.js`, `request.service.js` (options, create, withdraw, mine), `decision.service.js` (accept/reject/appeal/remove/group), `list.service.js`, `join.jobs.js` (`join.escalate`), `hooks.js`, `join.controller.js`, `join.routes.js`, `index.js`, `__tests__/join.api.test.js`.

**server/src/modules/auth/**: `students.service.js` (`activateStudentForSemester` takes the department; `departmentAdminIds`; `userCard`; `uvIdsOf`), `index.js`.

**server/src/modules/routine/**: `section.brief.js` (`listGroups`, `getGroupBrief`), `index.js`.

**Other server files**: `app.js` (mount), `server.js` (job registrar and `every('15 minutes')`), `notifications/templates/index.js` and `i18n/en.json` (`join_accepted`, `join_rejected`, `group_changed`), `test/harness.js` (model import), `__tests__/app.test.js` (error list).

**client/src/**: `features/join/{api.js,hooks.js}`, `routes/JoinPage.jsx`, `routes/WaitingPage.jsx`, `App.jsx`, `i18n/en.json`, `lib/query-keys.js`, `routes/__tests__/join.test.jsx`.

## Data model

- `enrolment`: adds `department_id`, `group_set_by`, `reason`, `appeal {at,status}`. Existing partial uniques kept.
- The applicant's UV ID is read from `user.uv_id` (spec 02 PRF-10). `uv_claim` and `user.claim_rejections` were removed by spec 24.
- Transactions: accept (enrolment, user state), remove from section (enrolment, user state, audit), create (enrolment + audit), reject (decision + audit).
- First action wins: `findOneAndUpdate({_id, status:'pending'})`; duplicate-key on the accepted-enrolment index → `CONFLICT`.

## API

As in the spec table, plus `GET /api/admin/join-requests?department_id&view=`. All bodies/params/queries validated with Zod. `can()` actions: `join.request`, `join.view_own`, `join.decide`, `join.group`, `join.admin`, `join.remove`. Audit: `join.request`, `join.accept`, `join.reject`, `join.withdraw`, `join.group_change`, `join.appeal`, `join.appeal_decision`, `join.remove`.

## UI

Join form (department → section → optional group; name on the first request; no UV ID; "department is still setting up" state), waiting screen (status, reason, CR/DCR card, withdraw, appeal). Texts under `join.*` in `en.json`. The CR dashboard list and admin cards stay in specs 17/18.

## Tests

Server API tests named `JR-xx …` for every item above, with cross-scope refusals (CR of another section, admin of another department, student, teacher), account-state tests and concurrency tests (CR+DCR accept together; one student sending two requests together). One client test for form and waiting screen.

## Build order

1. Shared schemas and errors, models.
2. Options, create, withdraw, mine.
3. Decision (accept/reject), emails, audit.
4. Escalation job, group change, removal from a section, appeals, admin list.
5. Client screens.
6. Run lint, tests, build; verify with `/verify-spec 10`.

## Out of scope

The semester-update screen (14), CR/DCR dashboard layout (17), admin dashboard cards (18), group chat membership (20).
