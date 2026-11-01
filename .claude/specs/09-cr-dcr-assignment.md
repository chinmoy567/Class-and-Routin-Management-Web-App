# 09: CR/DCR assignment

R1 · Status: Draft · Depends on: 04, 07 · PRD: CR/DCR assignment, Users & roles (notes), Student ID claim (Rules), Semesters and student updates (Draft) · Diagrams: 26-activity-cr-dcr-assignment, 02-role-hierarchy

## Goal

The department admin chooses each section's CR (one) and DCRs (up to two) for a semester. Naming the CR is what opens the section for join requests. The roles end at rollover.

## Scope

**In:** assigning and removing CR/DCR for sections of the current or draft semester, the one-CR and two-DCR limits, showing and re-appointing last semester's CR/DCR, the open/closed state of a section, the CR's own enrolment.

**Out:** what the CR/DCR can do (specs 10, 17), creating section groups (spec 20 hooks into the assignment), the rollover step that switches draft roles on (spec 14).

## Requirements

- **CRD-01** The admin of the section's department picks a **student** account that has a verified email and is not `deactivated` or `graduated`. No approved UV ID claim is needed. The admin's choice is the approval.
- **CRD-02** Role is `cr` or `dcr`, scoped to `section_id` and `semester_id`. A section has at most one CR and two DCRs in effect (`409 ROLE_LIMIT` with "This section already has a CR" or "already has two DCRs"). The limit is checked inside a transaction (count, then insert, with a write to the section document first, as in mongo-patterns §6).
- **CRD-03** A student holds at most one CR/DCR role per semester (`409 CONFLICT`).
- **CRD-04** Assigning in the **current** semester takes effect at once. The student gets an `accepted` enrolment in that section (no join request needed, group left empty for them to set). A `claim_pending` or `unconfirmed` student becomes `active`, and the profile is stamped with the semester. Any pending join request they have elsewhere in this semester is withdrawn.
- **CRD-05** Assigning in the **draft** semester stores the role with `semester_id` = draft. It isn't in effect until the draft becomes current (spec 14, which also creates the enrolment as in CRD-04).
- **CRD-06** A section of the current semester is **open** for join requests only while it has a CR in effect. Sections without a CR don't appear on the join form (spec 10).
- **CRD-07** For each section of the draft, the admin sees who was CR and DCR last semester in the **matching section**: same department and letter, one term earlier (2-I-A last → 2-II-A now, 1-II-A → 2-I-A). A one-click "re-appoint" assigns the same people, subject to CRD-01–03.
- **CRD-08** The admin can remove a role at any time. The role is ended (not deleted), and the student's CR/DCR dashboard disappears on the next request. Their enrolment stays. If the section is left with no CR, it closes for **new** join requests, and its pending join requests move to the admin queue (spec 10).
- **CRD-09** The student sees the role on their profile ("CR of CSE 2-II-A · Fall 2026"). Assignments and removals are audited and the student is emailed.
- **CRD-10** CR and DCR roles of a semester end when it is archived (spec 14).
- **CRD-11** `sections.isOpen(sectionId)` and `roles.crDcrOf(sectionId)` are exported for specs 10, 17 and 20.

## Permissions

| Action | Admin of section's dept | Super admin | Others |
|---|---|---|---|
| Assign / remove / re-appoint | ✔ | ✔ | ✘ |
| See CR/DCR of a section | ✔ | ✔ | members of the section, and the applicant to it (spec 10) |

## Data

Uses `user_role` (spec 03) with role `cr`/`dcr`, section_id and semester_id. Adds `section.role_seq` (number) for the limit check. Index `{ section_id: 1, role: 1, ended_at: 1 }`.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/admin/sections/:id/representatives` | admin | none | current CR/DCR + last semester's matching section | none |
| `POST /api/admin/sections/:id/representatives` | admin of dept | user_id, role | 201 | `ROLE_LIMIT`, `CONFLICT`, `USER_NOT_ELIGIBLE` |
| `POST /api/admin/sections/:id/representatives/reappoint` | admin of dept | none | 200 (list assigned + skipped with reasons) | none |
| `DELETE /api/admin/representatives/:roleId` | admin of dept | none | 204 | none |
| `GET /api/admin/students/search?q=&department_id=` | admin | none | eligible students (name, photo, UV ID if approved, state) | none |

## Jobs and events

- Email `role_assigned` / `role_removed`.
- Hook for spec 20: `onCrAssigned(section)` creates the section group if this is the first CR in effect for the section.

## Screens

Section detail (admin): CR and DCR slots with "assign" (student search) and "remove", last semester's people with "re-appoint". A readiness hint shows sections without a CR.

## Acceptance tests

- CRD-02: assigning a second CR → `ROLE_LIMIT`. A third DCR → `ROLE_LIMIT`. Two admins assigning a CR at the same moment → exactly one succeeds.
- CRD-03: the same student made DCR of a second section in the same semester → `CONFLICT`.
- CRD-04: assigning a `claim_pending` student as CR in the current semester makes them `active` with an accepted enrolment.
- CRD-05: a draft CR has no CR dashboard until the draft becomes current.
- CRD-06: a section without a CR doesn't appear on the join form.
- CRD-07: re-appoint uses 2-I-A's people for 2-II-A, and skips anyone now graduated (with the reason).
- CRD-08: after removing the only CR, a student's new join request to that section → `SECTION_CLOSED`, and existing pending requests show in the admin queue.

## Decisions and open questions

- **Decision:** one CR/DCR role per student per semester (CRD-03). The PRD doesn't say, but a student belongs to one section.
- **Decision:** the CR's UV ID. The CR gets an accepted enrolment without a join request (PRD: "the admin's assignment is their approval"). A CR who has no approved UV ID enters it from their profile, and the claim goes to the **department admin**, because a CR can't approve their own claim (spec 10 JR-17).
- **Decision:** "matching section" for re-appointing means same department and letter, one term earlier (CRD-07).
- **Decision:** losing the last CR closes the section for new requests only. Members stay.

## Tasks

- [ ] Assign service with eligibility, limits (transaction), current vs draft behaviour, enrolment creation
- [ ] Remove service + admin-queue handover for pending requests
- [ ] Re-appoint with matching-section lookup
- [ ] `isOpen` / `crDcrOf` exports, group-creation hook
- [ ] Emails + audit
- [ ] Section detail screen
- [ ] Tests
