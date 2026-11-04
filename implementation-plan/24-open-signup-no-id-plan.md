# Plan 24: Open sign-up, no UV ID

Status: **Draft, waiting for approval.** No code has been changed.

## Change in one paragraph

Any student can sign up with any email (university or personal). The only identity check is email verification. The UV ID claim is removed. The join request to the section's CR/DCR (spec 10) stays, so section groups stay private. Teachers are unchanged: they still need admin approval.

## Decisions (defaults I chose, change any of them)

1. **Student sign-up accepts any email domain.** The allowed-domain list (AUTH-05, AUTH-28) applies to **teacher** sign-up only. A teacher's personal email would otherwise let anyone ask to become a teacher; the admin approval still applies either way.
2. **The university email is not special.** Both kinds of student go through the same flow.
3. **The UV ID claim is removed entirely**: no claim, no approval, no uniqueness rule, no duplicate badge, no block after rejections, no revoke. What stays is one **optional text field `uv_id` on the student's profile** that the student fills in and can edit at any time. Nobody checks it. It is shown to the CR/DCR (and the department admin) on join requests and rosters, so they can recognise the person. It is stored as typed (trimmed, 1–20 digits, spaces and dashes removed) and is not unique. It is shown only to the CR/DCR of the section, the admin of the department, and teachers of that section's roster, as today.
   *Confirmed by the user: teachers need the university email; the admin approves teachers.*
4. **Join requests stay.** The CR/DCR still accepts or rejects, with the 3-day escalation to the admin. Rejection limits (JR-08) are renamed from "claim" rejections to "join request" rejections.
5. **CAPTCHA at student sign-up**, because open sign-up invites bots. The proof-of-work CAPTCHA already exists (AUTH-14); it is now required on sign-up for every student.

## Risk to accept

Without an ID, a CR/DCR can't tell two students with the same name apart, and an outsider with a believable name can ask to join. The CR/DCR decision is the only gate. The admin can still deactivate accounts and remove members.

## Steps

### 1. Documents first (no code)
- PRD: Users & roles table, "Student ID claim" section, account-states table (`claim_pending` is renamed or reworded), authentication section, F1/F4b rows, acceptance criteria for UV ID claims. Add the decision above to "Open questions → Decided".
- Specs: edit 01 (AUTH-05, AUTH-10, AUTH-29), 10 (remove the UV ID group of requirements JR-05..08, 18..19; reword JR-01, 11, 13), 09 (CRD, own-claim path), 16, 17, 18, 20, 21 where they show UV ID. Add `.claude/specs/24-open-signup-no-id.md`.
- Diagrams in `DOCUMENTS/src/`: 01-use-case, 04-architecture, 09-activity-student-onboarding, 15-seq-join-request, 20-state-join-request. Re-render the SVGs.

### 2. Server
- `auth`: sign-up checks the domain list only when `kind === 'teacher'`; the CAPTCHA is required on student sign-up.
- `join` / `enrolments`: drop `uv_id` from the request body and the Zod schema; remove `UV_ID_TAKEN`, `CLAIM_BLOCKED`, the duplicate-pending badge, the auto-rejection of duplicates, `POST /api/me/uv-claim`, `POST /api/admin/uv-claims/:id/revoke`; remove the `uv_claim` model and its partial unique index.
- Keep "revoke a student's membership" as an admin action on the **enrolment** (it replaces claim revocation).
- Remove UV ID from roster, search and dashboard responses (`roster.service`, `list.service`, `cr.lists`, `students.service`, `dashboard.service`).
- Migration: a one-off script that drops the `uv_claim` collection and unsets `uv_id_*` fields. Dev data only, so no data is lost in production. Confirm before running.

### 3. Client
- `JoinPage`: remove the UV ID input. `RosterCard`, `JoinRequestsCard`, `AdminStudentsPage`, `StudentSearchDialog`, `DashboardCards`, `SectionsTaughtCard`: remove UV ID columns and badges.
- Sign-up page: show the CAPTCHA to students; remove the "use your university email" text. Move strings in `client/src/i18n/en.json` and `server/src/i18n/en.json`.

### 4. Tests (written with the code)
- Student sign-up with `x@gmail.com` → 202; teacher sign-up with `x@gmail.com` → `EMAIL_DOMAIN_NOT_ALLOWED`.
- Student sign-up without a CAPTCHA → `CAPTCHA_REQUIRED`.
- Join request with a `uv_id` in the body → `VALIDATION_ERROR` (unknown key).
- Existing cross-section refusal, first-action-wins, and escalation tests stay.
- Delete the tests for the removed UV ID rules. Run `/run-checks` at the end.

## Order of work

Step 1 (documents) → review with you → steps 2 and 3 together in small commits → step 4 alongside them.

## Open questions

None. Both earlier questions were answered: teachers keep the university-email rule, and the UV ID becomes an optional profile field.

Server and client changes in step 2/3 change accordingly: the `uv_id` moves from the join request body to the profile update (spec 02), and join-request and roster responses read it from the user's profile instead of from a claim.
