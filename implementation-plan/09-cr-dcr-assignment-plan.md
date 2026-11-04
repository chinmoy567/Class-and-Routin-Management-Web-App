# Plan: 09 CR/DCR assignment

Spec: `.claude/specs/09-cr-dcr-assignment.md`. It depends on 04 (semesters) and 07 (sections, built), and on the `user_role` model from 03. Diagrams read: `26-activity-cr-dcr-assignment`, `02-role-hierarchy`, `22-state-semester-section`, `19-state-account`. None of the PRD's five open questions blocks this spec.

## Goal

The admin of a department chooses each section's CR (one) and DCRs (up to two) for a draft or current semester. Naming the CR opens the section for join requests. Assigning in the current semester takes effect at once. The student gets an accepted enrolment, and a `claim_pending` or `unconfirmed` student becomes `active`. Assigning in the draft semester only stores the role.

The admin can see last semester's CR and DCRs in the matching section and re-appoint them in one action. Removing a role ends it and closes the section to new requests if no CR is left. Every change is audited and emailed.

The spec also delivers `isOpen(sectionId)` and `crDcrOf(sectionId)` for specs 10, 17 and 20, and the admin screen.

## Rules and acceptance criteria

1. **CRD-01** The admin of the section's department, or a super admin, picks a **student** with a verified email whose state is `claim_pending`, `active` or `unconfirmed`. A `deactivated`, `graduated`, `email_unverified`, teacher or staff account gets `422 USER_NOT_ELIGIBLE`. No UV ID is needed.
2. **CRD-02** The role is `cr` or `dcr`, scoped to `section_id` and `semester_id`. A second CR or a third DCR returns `409 ROLE_LIMIT` with the matching message ("This section already has a CR" / "already has two DCRs"). The check runs in a transaction. Acceptance: a second CR → `ROLE_LIMIT`, a third DCR → `ROLE_LIMIT`, and two admins assigning a CR at the same moment → exactly one succeeds.
3. **CRD-03** A student holds at most one CR/DCR role per semester (`409 CONFLICT`). Acceptance: the same student made DCR of a second section in the same semester → `CONFLICT`.
4. **CRD-04** Assigning in the **current** semester takes effect at once. In one transaction:
   - the student gets an `accepted` enrolment in that section (no group);
   - a `claim_pending` or `unconfirmed` student becomes `active`, and the profile is stamped with the semester;
   - any pending join request they have elsewhere this semester is withdrawn.

   Acceptance: a `claim_pending` student made CR becomes `active` with an accepted enrolment.
5. **CRD-05** Assigning in the **draft** semester stores the role with `semester_id` = draft. It has no effect: no enrolment, no state change, and no dashboard or role in the user's session. Acceptance: a draft CR has no CR role on their request user.
6. **CRD-06** A section is **open** only while it has a CR in effect (CR role not ended, semester current). `isOpen` is false for a section without a CR and for any draft or archived section. Acceptance: a section without a CR is not open.
7. **CRD-07** For each section of the draft, the admin sees who was CR and DCR last semester in the **matching section**: same department and letter, one term earlier (2-I-A → 2-II-A, 1-II-A → 2-I-A). One "re-appoint" action assigns the same people under CRD-01–03 and returns `assigned` plus `skipped` with a reason for each. Acceptance: re-appoint uses 2-I-A's people for 2-II-A and skips anyone now graduated, with the reason.
8. **CRD-08** The admin can remove a role at any time. The role is ended (`ended_at`, `ended_by`), not deleted. The student's CR/DCR role disappears on the next request, and their enrolment stays. If no CR remains in effect, the section closes for **new** join requests and its pending requests are marked escalated, so they show in the admin queue (JR-15). Acceptance: after removing the only CR, `isOpen` is false and the pending requests are escalated. The `SECTION_CLOSED` response to a new join request belongs to spec 10.
9. **CRD-09** The student's own profile shows the role ("CR of CSE 2-II-A · Fall 2026"). Assign and remove are audited, and the student is emailed (`role_assigned` / `role_removed`).
10. **CRD-10** CR/DCR roles of a semester end when it is archived. This spec exports `endRolesOfSemester(semesterId, session)`, and spec 14 calls it.
11. **CRD-11** `isOpen(sectionId)` and `crDcrOf(sectionId)` are exported for specs 10, 17 and 20, along with the `onCrAssigned` hook registrar.
12. **Permissions.** Assign, remove, re-appoint, view and search are for an `active` admin of the section's department or a super admin. An admin of another department, a CR, a DCR, a teacher or a student gets 403.
13. **Extra: semester state.** Writes on an archived semester return `SEMESTER_ARCHIVED` (409).
14. **Extra: private data.** Responses never contain email or phone.
15. **Extra: hook.** `onCrAssigned(section)` runs after commit when a CR is assigned in the current semester. It is a no-op until spec 20.

## Assumptions

- **No open question blocks this spec.** The choices below are the safest minimal readings, made because this run is unattended.
- **The `enrolment` model belongs to spec 10, which is not built, but CRD-04 needs it.** This spec adds only the model and a few service functions in a small new `enrolments` module. The schema and indexes are copied from spec 10's Data section. Spec 10 extends that module. No join-request endpoints are added here.
- **Fields used from spec 10:** `user.confirmed_semester_id` (profile stamp) is added here to the `User` model. The student search returns the profile `uv_id` (spec 02 PRF-10, spec 24), or null.
- **A student already accepted in another section this semester.** The partial unique index allows one accepted enrolment per user per semester, and moving sections is a flag handled elsewhere (PRD). So assigning that student as CR/DCR of a different section of the **current** semester returns `409 CONFLICT` ("already enrolled in another section"). Assigning them to the section they are already in keeps their existing enrolment. Draft assignments are not affected.
- **The existing unique index on `user_role` blocks a student holding a current and a draft CR/DCR role.** The index is `{user_id, role, department_id}` on active rows. That blocks the re-appoint flow, so its key gets `semester_id` added. Admin and teacher rows have no `semester_id`, so their uniqueness is unchanged. Existing dev databases keep the old index until `syncIndexes()` is run, and the plan notes this.
- **"In effect" is derived from the semester status.** A CR/DCR role is in effect when `ended_at` is null and its semester is `current`. `loadRequestUser` (`auth.service.js`) drops cr/dcr rows of other semesters, so a draft CR has no powers. `auth` already imports `organisation`, so there is no new dependency direction.
- **"Last semester" in CRD-07.** For a draft target it is the current semester. For a current target it is the latest archived semester. The previous section is looked up in that semester with the same department and letter, one term earlier. A roles row counts as "last semester's person" unless it was ended by an admin removal (`ended_reason: 'removed'`). Rows ended by the rollover, or still active, count.
- **Student search scope.** Students have no department until they join. If `department_id` is given, the search matches students whose `department_id` equals it or is unset. A department admin must pass a department they administer (403 otherwise). Search needs `q` of at least 2 characters and returns at most 20 results.
- **Readiness hint needs one extra read endpoint:** `GET /api/admin/semesters/:id/representatives/summary?department_id=`. The spec's API table has no list of sections with their CR status, and the screen needs it.
- **Module placement.** The new `representatives` module follows the precedent of the `teachers` module. It reaches other modules through their `index.js` exports. To serialise the limit check, `routine` exports `bumpSectionRoleSeq(sectionId, session)`, so no module reads `section` directly.
- **Move of a draft's roles to effect (spec 14).** Spec 14 creates the enrolments and fires `onCrAssigned`. This spec exports nothing for that except `endRolesOfSemester`, and the model fields they need.
- **`SECTION_CLOSED`** is added to `shared/errors.js` by spec 10. Only `ROLE_LIMIT` is added here.
- **Student-visible role card** for members and applicants is spec 10 and 17. Here only the owner's profile shows the role.
- **Existing uncommitted work for spec 08** in the working tree is left alone.

## Files

**Server, `server/src/modules/representatives/` (new)**
- `representatives.model.js`: no new collection. This file only holds shared constants (role names) if needed. Roles live in `user_role`.
- `representatives.policy.js`: `representative.view`, `representative.manage`, `representative.search`.
- `assign.service.js`: eligibility, the transaction, current vs draft behaviour, audit and email.
- `remove.service.js`: end a role, escalate the pending requests, audit, email.
- `reappoint.service.js`: previous-section lookup, loop of assigns, skipped reasons.
- `query.service.js`: `crDcrOf`, `isOpen`, the section's representatives view with last semester, the summary and the student search.
- `previous-section.js`: pure function giving the previous (level, term) of a section.
- `hooks.js`: `registerCrAssignedHook`, `resetCrAssignedHooks`.
- `representatives.controller.js`, `representatives.routes.js`.
- `index.js`: `registerPolicies`, router exports, `isOpen`, `crDcrOf`, `endRolesOfSemester`, `registerCrAssignedHook`.
- `__tests__/representatives.api.test.js`, `__tests__/previous-section.test.js`.

**Server, `server/src/modules/enrolments/` (new, minimal)**
- `enrolment.model.js`: the `enrolment` schema and indexes from spec 10.
- `enrolment.service.js`: `createAcceptedForRepresentative`, `withdrawPendingForUser`, `escalatePendingOfSection`, `acceptedEnrolmentOf`.
- `index.js`.

**Server, other modules (changed)**
- `auth/auth.model.js`: `user_role` gets `is_representative`, `ended_reason`. Changed unique index key (adds `semester_id`). New partial uniques (see Data model). `User` gets `confirmed_semester_id`.
- `auth/auth.service.js`: `loadRequestUser` drops cr/dcr rows whose semester isn't current.
- `auth/index.js`: export `activateStudentForSemester(userId, semesterId, session)` (state → `active`, stamp), `findEligibleStudents`, and `studentSummaries(userIds)` (name, photo, state).
- `auth/profile.service.js`: own profile gets the `representative` object, and the public profile label only counts roles in effect.
- `routine/routine.model.js`: `role_seq: Number, default 0` on `section`.
- `routine/index.js`: export `bumpSectionRoleSeq`, `getSectionBrief(id)` (department, semester, level, term, letter, closed_at), `findSectionByBatch(semesterId, departmentId, level, term, letter)`, `listSectionsBrief(semesterId, departmentId)`.
- `organisation/index.js`: nothing new expected (uses `getSemester`, `currentSemester`, `draftSemester`, `departmentNames`).
- `notifications/templates/index.js`: `role_assigned`, `role_removed`.
- `server/src/i18n/en.json`: email keys.
- `app.js`: mount the router at `/api/admin` behind `requireAuth`.
- `shared/errors.js`: `ROLE_LIMIT` (409). `server/src/__tests__/app.test.js`: update the error-code list (FND-11).

**Shared**
- `shared/schemas/representatives.js`: `assignBody`, `sectionIdParam`, `roleIdParam`, `searchQuery`, `summaryQuery`. Exported from `schemas/index.js`.

**Client, `client/src/`**
- `features/representatives/api.js`, `hooks.js`.
- `features/representatives/components/`: `RepresentativeSlots.jsx`, `StudentSearchDialog.jsx`, `LastSemesterCard.jsx`, `ReappointResult.jsx`, `SectionReadinessList.jsx`.
- `routes/admin/RepresentativesPage.jsx`.
- `App.jsx` (route `/admin/representatives` inside `RequireAdmin`), `components/AppShell.jsx` (nav link).
- `routes/ProfilePage.jsx` (role line).
- `i18n/en.json` (`representatives.*`, `nav.adminRepresentatives`, `profile.representative`), `lib/query-keys.js`.
- `routes/__tests__/representatives.test.jsx`.

## Data model

- **`user_role`** (cr/dcr rows): `user_id`, `role` (`cr`|`dcr`), `department_id` (the section's), `section_id`, `semester_id`, `is_representative: true`, `granted_by`, `granted_at`, `ended_at` (null while active), `ended_by`, `ended_reason` (`removed`).
- **Indexes on `user_role`:**
  - `{ section_id: 1, role: 1, ended_at: 1 }` (the spec's lookup index).
  - Changed: `{ user_id, role, department_id, semester_id }` unique, partial on `ended_at: null` (was without `semester_id`).
  - New backstop for CRD-03: unique `{ user_id, semester_id }`, partial on `{ is_representative: true, ended_at: null }`.
  - New backstop for one CR: unique `{ section_id }`, partial on `{ role: 'cr', ended_at: null }`.
  - Duplicate-key errors (11000) are mapped by key pattern: the section index to `ROLE_LIMIT`, the user index to `CONFLICT`.
- **`section.role_seq`**: Number, default 0, the serialising write for the limit check.
- **`enrolment`** (spec 10 shape): `user_id`, `semester_id`, `section_id`, `group_id?`, `status` (`pending`|`accepted`|`rejected`|`withdrawn`|`revoked`), `escalated_at?`, `decided_by?`, `decided_at?`, `created_at`. Indexes:
  - partial unique `{ user_id, semester_id }` where `status: 'accepted'`;
  - partial unique `{ user_id }` where `status: 'pending'`;
  - `{ section_id, status, created_at }`.
- **`user.confirmed_semester_id`**: ObjectId.
- **Assign transaction (mongo-patterns §6):**
  1. Bump `section.role_seq` first. Concurrent assigns write-conflict, one retries, and the retry sees the other's insert.
  2. Check CRD-03 (a role of this user in this semester).
  3. Count the section's active cr/dcr rows. Return `ROLE_LIMIT` if over.
  4. Insert the `user_role` row.
  5. Current semester only: refuse if accepted elsewhere. Otherwise withdraw the pending enrolments (conditional `updateMany` on `status: 'pending'`), create the accepted enrolment unless one already exists in this section, and call `activateStudentForSemester`.
  6. Write the audit entry in the same transaction.
- **Remove transaction:**
  1. Bump `role_seq` first.
  2. `findOneAndUpdate({ _id, ended_at: null }, { ended_at, ended_by, ended_reason: 'removed' })`. If nothing matches, return `404 NOT_FOUND`.
  3. If the role was a CR and the semester is current and no other CR is in effect, call `escalatePendingOfSection` (conditional update of `pending` rows with no `escalated_at`).
  4. Write the audit entry.
- **After commit:** enqueue the email, emit `routine.changed` to `user:<id>` for current-semester changes, and run the `onCrAssigned` hook for a current-semester CR.
- **`audit_log`** stays insert-only. Actions: `representative.assign` (new_value: role, section, semester, `via: 'manual'|'reappoint'`), `representative.remove`. Each carries `scope_department_id` and the target user.

## API

All routes are mounted at `/api/admin` behind `requireAuth` and use the Zod `validate` helper. Errors use the standard format. Mutating routes get CSRF through the existing middleware.

| Method and path | Zod | `can()` check | Result and errors | Audit |
|---|---|---|---|---|
| `GET /api/admin/sections/:id/representatives` | `sectionIdParam` | `representative.view` `{department_id: section dept}` (state `active`, role admin, scope dept) | `{ section, semester_status, representatives: [{role_id, user_id, role, full_name, photo_url, state}], last_semester: {section, representatives} or null }`. 404 for unknown id. | none |
| `POST /api/admin/sections/:id/representatives` | `sectionIdParam`, `assignBody {user_id, role}` | `representative.manage` on the section's dept | 201 `{role_id, ...}`. `ROLE_LIMIT`, `CONFLICT`, `USER_NOT_ELIGIBLE`, `SEMESTER_ARCHIVED`, 404. | `representative.assign` |
| `POST /api/admin/sections/:id/representatives/reappoint` | `sectionIdParam` | `representative.manage` | 200 `{assigned: [...], skipped: [{user_id, full_name, role, reason}]}`. Reasons: `USER_NOT_ELIGIBLE`, `ROLE_LIMIT`, `CONFLICT`, `ALREADY_ASSIGNED`. | one `representative.assign` (`via: reappoint`) per assigned person |
| `DELETE /api/admin/representatives/:roleId` | `roleIdParam` | `representative.manage` on the role's dept | 204. 404 if missing or already ended. | `representative.remove` |
| `GET /api/admin/students/search?q=&department_id=` | `searchQuery` | `representative.search` (any active admin); a given `department_id` needs `isAdminOf` | `[{id, full_name, photo_url, uv_id (from the profile, or null), state}]`, no email or phone | none |
| `GET /api/admin/semesters/:id/representatives/summary?department_id=` | `summaryQuery` | `representative.view` `{department_id}` | `[{section_id, name, has_cr, dcr_count, groups?}]` for the readiness hint | none |

- **Policies** (`representatives.policy.js`) all require state `active` and the admin role, using `stateIn`, `hasRole` and `isAdminOf` from `policy/index.js`.
- **Not found vs forbidden.** Admin routes follow spec 08: an admin of another department gets 403. A non-admin gets 403 from the policy.
- **Exports for other modules** (index.js):
  - `crDcrOf(sectionId)`: in-effect roles `[{role_id, user_id, role}]`.
  - `isOpen(sectionId)`: current semester, no `closed_at`, and a CR in effect.
  - `endRolesOfSemester(semesterId, session)`: sets `ended_at` on all active cr/dcr rows of that semester.
  - `registerCrAssignedHook`.

## UI

New page `/admin/representatives`, mobile first (360 px), all text under `representatives.*` in `en.json`. It follows the pattern of the routine edit page and reuses the admin department picker (`useAdminDepartment`) and the semester list hook.

- **Pickers:** semester (draft or current), department (admins with several departments, and super admins), then a section list.
- **Readiness list:** every section of the department with a "No CR yet" badge, the DCR count and a link to open it. A hint banner counts sections without a CR.
- **Section detail:**
  - One CR slot and two DCR slots, each showing name, photo and state, with **Assign** (when empty) or **Remove** (when filled).
  - A "Not in effect until this semester becomes current" note for draft sections.
  - A **Last semester** card showing the matching section's CR and DCRs, with a **Re-appoint** button.
- **Student search dialog:** an inline `role="dialog"` panel. The search input is debounced, and results show name, photo, UV ID if any and state. Choose the student, then Confirm. Server errors show in plain words: `ROLE_LIMIT` ("This section already has a CR" / "…two DCRs"), `CONFLICT`, `USER_NOT_ELIGIBLE`.
- **Re-appoint result:** a list of assigned people and skipped people with the translated reason.
- **Remove confirmation** before the request.
- **Profile page:** a line "CR of CSE 2-II-A · Fall 2026" for the owner, built from the server's `representative` object.
- **Account-state screens:** nothing new. The page is behind `RequireAdmin` and the server enforces the policy anyway. Students see the role only on their own profile.
- **Accessibility:** labelled inputs, focus moved into and back out of the dialog, status text not conveyed by colour only.

## Tests

Server API tests are named `CRD-xx …` (Vitest, Supertest, in-memory replica set via the existing harness). The checklist numbers are in brackets.

| # | Test |
|---|---|
| 1 | Assign CR and DCR in a current-semester section: 201, role row has section, semester and department (1, 2, 4). |
| 2 | A second CR → `ROLE_LIMIT` ("already has a CR"). Two DCRs succeed, a third → `ROLE_LIMIT` ("two DCRs"). Ending a role frees the slot (2). |
| 3 | The same student as DCR of a second section in the same semester → `CONFLICT`. The same student in a draft and a current semester is allowed (3). |
| 4 | Ineligible: `deactivated`, `graduated`, `email_unverified`, a teacher and a staff account → `USER_NOT_ELIGIBLE`. `claim_pending`, `unconfirmed` and `active` are accepted. No UV ID is needed (1). |
| 5 | A `claim_pending` student made CR in the current semester becomes `active`, has an accepted enrolment with no group, is stamped with the semester, and their pending request elsewhere is `withdrawn` (4). |
| 6 | A student already accepted in another section of the current semester → `CONFLICT`. In their own section the existing enrolment is kept (assumption). |
| 7 | Draft assignment: the role is stored, no enrolment is created, the state is unchanged, and `loadRequestUser` has no cr role (5). |
| 8 | `isOpen`: false with no CR, true with a CR in the current semester, false for a draft section, a closed section, and after removal of the only CR (6, 8). |
| 9 | Previous-section unit tests: 2-II → 2-I, 2-I → 1-II, 1-I → none. |
| 10 | Re-appoint (draft): 2-I-A's people appear in 2-II-A's view and are assigned. A graduated one is skipped with `USER_NOT_ELIGIBLE`. A person who was removed by an admin last semester is not offered. A second re-appoint skips with `ALREADY_ASSIGNED` (7). |
| 11 | Remove: the role gets `ended_at` and stays in the collection. The enrolment stays. The next request has no cr role. Removing the last CR escalates the section's pending enrolments, and removing a DCR does not (8). |
| 12 | Audit entries for assign (manual and re-appoint) and remove, with department scope and values. Emails `role_assigned` and `role_removed` are queued to the student. No email or phone appears in any response (9, 14). |
| 13 | Own profile shows the representative line for the owner only. A draft or ended role does not show (9). |
| 14 | `endRolesOfSemester` ends all active cr/dcr rows of that semester only (10). |
| 15 | `onCrAssigned` hook fires once for a current-semester CR, not for a DCR or a draft CR (15). |
| 16 | Archived semester → `SEMESTER_ARCHIVED` (13). Malformed ids or bodies → `VALIDATION_ERROR`. |
| 17 | **Cross-scope refusal:** a CSE admin gets 403 on GET, POST, reappoint and DELETE for an EEE section and role, and on search with the EEE `department_id`. A student, CR, DCR, teacher, an inactive (deactivated) admin and a pending teacher are all refused on every route. A super admin can act in any department (12). |
| 18 | **Concurrency:** two admins POST a CR at the same moment → one 201 and one `ROLE_LIMIT`. Two simultaneous DCR assigns when one slot is left → one wins. The same student assigned to two sections at once → one 201 and one `CONFLICT`. Assign racing a remove of the same section stays consistent (2, 3). |
| 19 | Summary endpoint lists sections without a CR, and a student search returns only eligible students without email or phone (2, 14). |
| 20 | Regression: the existing auth, teacher admin and routine tests stay green after the `user_role` index change and the `loadRequestUser` change. FND-11 is updated for `ROLE_LIMIT`. |

- **Carried to spec 10:** the join form hides sections without a CR (CRD-06) and a new request to a closed section returns `SECTION_CLOSED` (CRD-08). This plan tests the `isOpen` and escalation side only, because those endpoints don't exist yet.
- **Client test** (`representatives.test.jsx`): the slots show filled and empty states, the search dialog assigns and shows the translated `ROLE_LIMIT`, `CONFLICT` and `USER_NOT_ELIGIBLE` messages, the re-appoint result shows skipped reasons, the remove confirmation sends the request, the draft note appears, and a non-admin cannot reach the route.
- **Browser (Playwright):** none needed. Run it only on request.
- **Note:** on this Windows machine use Node 24.22.2 for the test runs, because 24.15.0 kills the vitest workers.

## Build order

1. Shared schemas, `ROLE_LIMIT`, the `user_role` fields and index changes, `section.role_seq`, `user.confirmed_semester_id`, and the policies. Run the existing auth, teachers and routine tests, then the previous-section unit tests (tests 9, 20).
2. The minimal `enrolments` module, the routine and auth exports, and `loadRequestUser` filtering (test 7 part, 20).
3. Query side: `crDcrOf`, `isOpen`, the representatives view, summary and student search, with the read endpoints and the cross-scope tests (tests 8, 17 read, 19).
4. Assign service with eligibility, limits and current vs draft behaviour, plus the audit entry, email and hook (tests 1–7, 12, 15, 16).
5. Remove service with the pending-request escalation (tests 8, 11).
6. Re-appoint with the matching-section lookup (test 10).
7. `endRolesOfSemester`, the profile line (tests 13, 14).
8. Concurrency tests (test 18).
9. Client: api and hooks, page, components, i18n, route, nav and profile line, with the client test.
10. `run-checks` skill (lint, tests, build).
11. Walk the checklist and confirm each item has a passing test.

## Out of scope

- What the CR/DCR can do, and the CR/DCR dashboard (specs 10, 17).
- Join requests, the join form and `SECTION_CLOSED` responses (spec 10).
- Creating the section group chat (spec 20 hooks into `onCrAssigned`).
- The rollover step that switches draft roles on, creates their enrolments and fires the hook (spec 14).
- The admin dashboard cards and the audit log view (spec 18).
- Student removal requests, announcements and the in-app notification centre.
- Moving a student between sections.
- Any new library.
- Committing.

## Departures from the plan (as built)

- No `representatives.model.js` was created: roles live in `user_role`, so there was nothing to put in it.
- The auth reads for students are in `auth/students.service.js` (`representativeCandidate`, `activateStudentForSemester`, `studentSummaries`, `findEligibleStudents`). The routine reads are in `routine/section.brief.js`.
- The shared param schema for the role id is named `representativeRoleParam`, because `roleIdParam` already exists (spec 03).
- The owner's profile line comes through a new hook, `registerRepresentativeProvider` in `auth/profile.service.js`, so `auth` does not import `routine`.
- `organisation` exports `latestArchivedSemester()` for CRD-07 when the target is the current semester.
- Email templates now interpolate the subject (`simple()` passed no data to the subject).
- The existing profile test (PRF-01) now creates a current semester for its CR role, because a CR role outside the current semester is dropped from the request user (CRD-05).
- The summary route reuses `sectionIdParam` (`:id` is the semester id).
- Client tests for the new screen are in `routes/__tests__/representatives.test.jsx`. Two helpers in the new components are named functions, because the FND-32 text-scan regex misreads `=> … <` as hard-coded JSX text.
- Prettier warnings remain in files this spec did not touch (spec 07 routine files, `teachers/directory.service.js`, `scripts/auto-run.mjs`, `server/package.json`).
