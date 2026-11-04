# 24: Open student sign-up, no UV ID claim

R1 · Status: Planned · Depends on: 01, 02, 10 · PRD: Users & roles, Account states and access, Authentication & onboarding, Student ID claim (to be rewritten) · Diagrams: 09-activity-student-onboarding, 15-seq-join-request, 20-state-join-request, 19-state-account

## Goal

A student signs up with any email, verifies it, and sends a join request to a section. The CR or DCR of that section decides. The system never checks a university ID. A student may write their UV ID on their profile so the CR/DCR can recognise them. Teachers still sign up with a university email and are approved by the department admin.

## Supersedes

This spec changes these requirements. Where it conflicts with them, this spec wins. The old specs and the PRD are edited to match (step 1 of `implementation-plan/24-open-signup-no-id-plan.md`).

- Spec 01: AUTH-05 (domain gate), AUTH-10 (student lands in `claim_pending`), AUTH-28 (domain list scope), AUTH-29 (`join-form`).
- Spec 10: JR-01 (UV ID in the form), JR-05 to JR-08, JR-11 (claim approval), JR-12, JR-18, JR-19, and the `uv_claim` data and API rows.

## Requirements

### Sign-up
- **OS-01** Student sign-up accepts any email domain. The allowed-domain list applies to **teacher** sign-up only (`400 EMAIL_DOMAIN_NOT_ALLOWED` for a teacher with an unlisted domain).
- **OS-02** Student sign-up always requires the CAPTCHA (`403 CAPTCHA_REQUIRED` without it). Teacher sign-up keeps its current behaviour.
- **OS-03** The university email gets no special treatment. A student with a `baiust.ac.bd` address follows the same flow as one with any other address.
- **OS-04** Email verification is the only identity check. Verifying moves a student to the state that today is called `claim_pending` (see Decisions).

### UV ID
- **OS-05** `user.uv_id` is an optional text field on a student's profile: trimmed, spaces and dashes removed, leading zeros kept, 1–20 digits, or empty. It is **not unique**, is never checked against anything, and can be edited or cleared at any time (spec 02).
- **OS-06** The join form has no UV ID input. Sending a request with `uv_id` in the body is `400 VALIDATION_ERROR`.
- **OS-07** The CR/DCR of the section and the department admin see the applicant's `uv_id` (if any) on a join request, and on the section roster. A teacher sees it on the roster of a section they teach. Nobody else sees it. It is never in chat, search results for other roles, or public profiles.
- **OS-08** None of these exist any more: the `uv_claim` collection, `UV_ID_TAKEN`, `CLAIM_BLOCKED`, the duplicate-pending badge, automatic rejection of duplicate claims, `POST /api/me/uv-claim`, `POST /api/admin/uv-claims/:id/revoke`, and the `user.claim_rejections` counter.

### Join requests (unchanged unless listed)
- **OS-09** The CR/DCR decision, first-action-wins, the 3-day escalation to the admin, groups, appeals and withdrawal work as in spec 10.
- **OS-10** Join request rejections have no count-based block. Abuse is handled by the existing one-open-request rule (JR-02), the sign-up and sign-in rate limits, and the admin deactivating the account.
- **OS-11** The admin can **remove a student from a section** (the enrolment becomes `revoked` and the account goes back to the waiting state), with a reason, audited. It replaces JR-19.
- **OS-12** A CR/DCR's own join request goes straight to the department admin (JR-18, rewritten without the claim).

### Teachers
- **OS-13** Teacher rules are unchanged: university email only, then admin approval (spec 06).

## Decisions and open questions

- **Decision:** the state name `claim_pending` is kept in the code and in the PRD's state table for now, with its meaning changed to "verified, has no accepted join request". Renaming it would touch every spec, test and policy in the project, and can be done later on its own.
- **Decision:** no automatic migration of old `uv_claim` data. The old claims are dropped and each approved claim's UV ID is copied once into `user.uv_id` by a one-off script, so existing students keep their ID. Confirm before running it.
- **Open:** none.

## Acceptance tests

- OS-01: student `x@gmail.com` → 202. Teacher `x@gmail.com` → `EMAIL_DOMAIN_NOT_ALLOWED`. Teacher `x@baiust.ac.bd` → 202.
- OS-02: student sign-up with no CAPTCHA → `CAPTCHA_REQUIRED`.
- OS-04: a verified student can open the join form; before verifying, they cannot.
- OS-05: saving `08 22-3102` stores `0822 3102` without separators; 21 digits → `VALIDATION_ERROR`; two students may hold the same value.
- OS-06: a join request with `uv_id` → `VALIDATION_ERROR`.
- OS-07: the CR of 2-II-A sees the `uv_id` of an applicant to 2-II-A and gets `404` for 2-II-B's requests; a teacher of another section never sees it; a student never sees another student's.
- OS-08: the removed routes return `404`.
- OS-09: CR and DCR decide the same request at once → one `200`, one `ALREADY_DECIDED`.
- OS-11: an admin of another department cannot remove a student (`403`).

## Tasks

- [ ] PRD, specs 01, 02, 09, 10, 16, 17, 18, 20, 21 edited to match
- [ ] Diagrams updated and re-rendered
- [ ] Server: sign-up rules, CAPTCHA, join schema, remove claim code, profile `uv_id`, roster and request responses
- [ ] Client: sign-up, join page, profile field, roster and admin screens
- [ ] One-off script: copy approved claims to `user.uv_id`, drop `uv_claim`
- [ ] Tests for every OS requirement; remove tests for the dropped rules
