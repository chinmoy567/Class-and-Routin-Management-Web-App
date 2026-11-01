# Plan: spec 02 — Profile

Spec: `.claude/specs/02-profile.md` (the only match; specs live in `.claude/specs/`, not `specs/`).
Save target after approval: `implementation-plan/02-profile-plan.md` (does not exist yet).

## Goal

Every signed-in user gets one profile page: see own details (name, decrypted email and phone, photo, kind, roles, teacher/student block), edit phone, upload/delete a photo (content-sniffed, stored in GridFS, ClamAV-scanned by a background job), and change email through a verification link sent to the new address. Others see only a small public profile (name, photo, department, role labels). A department admin can rename a user. A bouncing email makes `/api/auth/me` return `email_action_required: true` and the client shows a banner. Builds on spec 01 (`User`, `OneTimeToken`, `change_email` purpose, mail queue, `can()`, audit).

## Decisions made with you

- **Photo upload is a raw body**, not multipart (Express can't parse multipart and busboy/multer are not in `tech-stack.md`). `PUT /api/me/photo` takes the file bytes with `Content-Type: image/*`, read with built-in `express.raw`, 2 MB cap. Spec wording ("multipart `photo`") is updated to match.
- **ClamAV client is hand-written** on `node:net` (clamd `INSTREAM` protocol, `CLAMAV_HOST` + new optional `CLAMAV_PORT`, default 3310). No new library. Tests inject a fake scanner.
- **Missing data returns null until later specs.** Student department/level/term/section/group/confirmed-semester (spec 10), teacher short-code link (spec 06), and department/section/semester names (specs 03/04/09) don't exist. A registered provider hook `registerProfileExtras({ student, teacher })` (same pattern as `registerOpenJoinRequestCheck`) fills them later; default returns nulls. Admin rename of a *student* works for super admin only until spec 10 supplies a department; teachers use `user.department_id`.

## Rules and acceptance criteria checklist

1. **PRF-01** Own profile returns full_name, email (decrypted), phone (decrypted), photo status/url, kind, roles, student block (dept, level, term, section, group, confirmed semester) or teacher block (dept, short code / "not linked yet"). Owner only.
2. **PRF-02** Only an admin of the user's department can rename; self-rename is impossible (`PATCH /api/me/profile` rejects `full_name`).
3. **PRF-03** Phone optional, encrypted, accepted as `01XXXXXXXXX` or `+8801XXXXXXXXX`, stored `+8801XXXXXXXXX`; `null` clears. [A] `01712345678` → `+8801712345678`; `12345` → `VALIDATION_ERROR`.
4. **PRF-04** Photo JPEG/PNG/WebP by content (magic bytes), ≤ 2 MB, GridFS bucket `photos`, ClamAV scan before use, served only to signed-in users, old photo (or initials) shown until the scan passes, infected file deleted and user told. [A] `.png` that is a PDF → `FILE_TYPE_NOT_ALLOWED`; 2.1 MB → `FILE_TOO_LARGE`; infected never becomes `photo_file_id`.
5. **PRF-05** Email change: allowed domain, not taken, link to the **new** address (24 h, single use); old email works until confirmed; on completion replace `email_hmac` + `email_enc`, clear `email_bouncing`, notice to the old address. [A] old email still signs in before confirm, only new after, old address got a notice. [A] taken since → `CONFLICT`.
6. **PRF-06** `/api/auth/me` returns `email_action_required: true` while `email_bouncing`; client banner until changed.
7. **PRF-07** `GET /api/users/:id`: only name, photo, department, role labels; never level/term/section/group/phone/email; available to chat-enabled accounts and admins of that user's department. [A] teacher viewing a student gets no `level`, `section`, `phone`, `email` keys.
8. **PRF-08** Audit `user.phone_change`, `user.photo_change`, `user.email_change`, `user.name_change` without phone/email values.
9. **PRF-09** Edit-own allowed in every signable state except `email_unverified`. [A] `email_unverified` → `403 STATE_NOT_ALLOWED`.
10. **CLAUDE.md rules:** all actions through `can()` (state + role + scope); CSRF on state changes (global); email/phone never in logs, rosters, public profile or admin responses; photo unavailable until scanned; owner's id comes from the session, never the request; "first action wins" for the email token; unique `email_hmac` is the final guard against two accounts taking one address.

## Blockers / open questions

- None blocks building. PRD open questions 1–5 don't touch this spec (Q1, university mail, only affects live mail delivery).
- Noted gaps filled by the hook above: role label text (e.g. "CR of CSE 2-II-A · Fall 2026") needs section/semester names, so for now the label is the plain role ("CR"); same for department display (returns `department_id`, client shows the name once spec 03 exists).
- Public-profile viewer rule ("chat-enabled accounts") has no chat policy yet (spec 20). I add `profile.view_public` allowing `active`/`unconfirmed`/`graduated` students, `active` teachers and active staff, plus admins of the target's department; spec 20 may later reuse or replace it. A `claim_pending` student can't view public profiles for now.

## Files

**shared/**
- `schemas/profile.js` (+ export in `schemas/index.js`): `phoneSchema` (normalises), `updateProfileBody` (`{ phone }`, strict), `changeEmailBody`, `confirmEmailBody`, `renameBody`, `userIdParam`.
- `errors.js`: add `FILE_TYPE_NOT_ALLOWED` (415), `FILE_TOO_LARGE` (413).
- `__tests__`: phone normalisation cases.

**server/src/lib/**
- `clamav.js` — `scanBuffer/scanStream` over `node:net` INSTREAM; `setScanner()` for tests.
- `imageType.js` — `sniffImage(buffer)` → `image/jpeg|png|webp|null` from magic bytes.
- `gridfs.js` — `photosBucket()` (GridFSBucket `photos`) helpers: put, open stream, delete.

**server/src/modules/auth/** (profile lives with the user in `auth`; no new module)
- `auth.model.js` — add `user.pending_photo_file_id`, `user.photo_scan_failed_at`.
- `auth.policy.js` — export the signable list; add `profile.view_own`, `profile.edit_own`, `profile.view_public`, `profile.rename`.
- `profile.service.js` — `getOwnProfile`, `updatePhone`, `getPublicProfile` (`toPublic`), `renameUser`, `registerProfileExtras`.
- `photo.service.js` — `uploadPhoto`, `deletePhoto`, `streamUserPhoto`, `scanPhoto` (job body).
- `photo.jobs.js` — `defineJobs(define)` registering `photo.scan` (idempotent, uses `withRetry` via `define`).
- `emailChange.service.js` — `requestEmailChange`, `confirmEmailChange`.
- `profile.controller.js`, `profile.routes.js` — `meProfileRouter` (mounted at `/api/me`), `usersRouter` (`/api/users`), admin rename router (mounted under `/api/admin`).
- `auth.service.js` — `getMe` adds `email_action_required`.
- `index.js` — export routers, `registerProfileExtras`, `defineAuthJobs`.
- `__tests__/profile.api.test.js`, `photo.api.test.js`, `emailChange.api.test.js`, `publicProfile.api.test.js`, `rename.api.test.js`.

**server/src/**
- `app.js` — mount `meProfileRouter`, `usersRouter`, admin rename route; route-level `express.raw` for the photo route only.
- `server.js` — add auth job registrar to `startJobs`.
- `config.js` — optional `CLAMAV_PORT` (default 3310); `.env.example` updated.
- `lib/errors.js` — map raw-body `entity.too.large` on the photo route to `FILE_TOO_LARGE`.
- `modules/notifications/templates/index.js` + `i18n/en.json` — `email_change_confirm` (to new address), `email_changed_notice` (to old address).
- `test/harness.js` — `drainMail`, fake scanner helper; `test/factories.js` — `makeUser` gains `phone`.

**client/src/**
- `features/profile/api.js`, `hooks.js` (`useProfile`, `useUpdatePhone`, `useUploadPhoto`, `useDeletePhoto`, `useRequestEmailChange`, `useConfirmEmail`, `usePublicProfile`), `components/Avatar.jsx` (photo or initials), `PhotoCard.jsx`, `PhoneForm.jsx`, `ChangeEmailForm.jsx`, `RolesList.jsx`, `EmailActionBanner.jsx`.
- `routes/ProfilePage.jsx`, `PublicProfilePage.jsx`, `ConfirmEmailPage.jsx` (open to anyone, like `/verify`).
- `lib/api.js` — accept a `Blob` body (sent as-is with its content type).
- `lib/query-keys.js` — `profile`, `user(id)`.
- `components/AppShell.jsx` — Profile nav item + banner; `App.jsx` — routes `/profile`, `/users/:id`, `/confirm-email`.
- `i18n/en.json` — `profile.*`, `emailBanner.*`, new error keys.
- `__tests__` for each page/form.

## Data model

- `user` (existing): add `pending_photo_file_id: ObjectId`, `photo_scan_failed_at: Date`. `email_enc`/`phone_enc` stay `select:false`. No new collection; email-change token is a `one_time_token` (`purpose: 'change_email'`, `payload: { email_enc, email_hmac }`, 24 h). Unique `email_hmac` index (existing) is the final guard.
- GridFS bucket `photos`: metadata `{ owner_id, scan_status: 'pending'|'clean'|'infected', content_type }`; index on `metadata.owner_id`.
- Transactions: `confirmEmailChange` = consume token + replace email + clear bouncing + audit in one `withTransaction`; catch Mongo `11000` → `CONFLICT` (tx rolls back so the token stays unused). Photo promotion = conditional `findOneAndUpdate({ _id, pending_photo_file_id: fileId }, …)` so a stale scan can't promote (first/latest wins); old file deleted after. Rename and phone change write audit in the same transaction.

## API

All under `/api`, JSON `{ data }` / `{ error }`, Zod via `validate()`, owner id from the session.

| Endpoint | Zod | `can()` / scope | Audit |
|---|---|---|---|
| `GET /me/profile` | – | `profile.view_own` (signable, not `email_unverified`) | – |
| `PATCH /me/profile` | `updateProfileBody` `{ phone: string\|null }` strict | `profile.edit_own` | `user.phone_change` (no value) |
| `PUT /me/photo` | raw ≤ 2 MB, sniffed | `profile.edit_own` | `user.photo_change` when it goes live; 202 `{scan_status:'pending'}`; enqueues `photo.scan` |
| `DELETE /me/photo` | – | `profile.edit_own` | `user.photo_change` |
| `POST /me/email` | `changeEmailBody` | `profile.edit_own`; domain allowed; not taken → `CONFLICT`; 3/hour per user → `RATE_LIMITED` | – |
| `POST /me/email/confirm` | `confirmEmailBody` | anyone with the link (token is the credential) | `user.email_change` (no addresses) |
| `GET /users/:id` | `userIdParam` | `profile.view_public` (state/role + admin-of-dept scope); hidden/unknown → `NOT_FOUND` | – |
| `GET /users/:id/photo` | `userIdParam` | any signed-in account past the second step; only `photo_file_id`, `Cache-Control: private` | – |
| `PATCH /admin/users/:id/name` | `renameBody` | `profile.rename` = `isAdminOf(target.department_id)`; else `FORBIDDEN` | `user.name_change` (old/new name, `scope_department_id`) |
| `GET /auth/me` (existing) | – | – | adds `email_action_required` |

Job `photo.scan`: ClamAV; clean → promote + delete previous + audit; infected → delete file, clear pending, set `photo_scan_failed_at`; scanner unreachable → throw so `withRetry` retries (photo stays pending).

## UI

- `/profile`: header with Avatar and name; details card (email, phone, kind, roles); student block / teacher block ("not linked yet"); semester badge placeholder; forms: phone (React Hook Form + Zod from shared), photo (file input, client-side type/size precheck, shows "checking your photo…" while pending and an error when `photo_scan_failed_at`), change email (shows "check the new address" state). Name is read-only with a hint that admins change it.
- `/users/:id`: public card (Avatar, name, department, role chips).
- `/confirm-email?token=`: calls confirm, shows success / expired / "address taken".
- `EmailActionBanner` in `AppShell` when `email_action_required` (links to change-email form), until cleared.
- Account states: `email_unverified` never reaches these screens (the step-route guard already holds it); an API 403 `STATE_NOT_ALLOWED` shows a message. Mobile first (360 px), labels, `aria-live` for status, 44 px targets.
- Translation keys: `profile.*`, `emailBanner.*`, errors for `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, `EMAIL_DOMAIN_NOT_ALLOWED`, `CONFLICT`, `TOKEN_INVALID`.

## Tests (named `PRF-xx …`, mapped to checklist numbers)

Server (Vitest + Supertest + replica set):
- #3 phone: normalises `01712345678`/`+8801712345678`/with spaces; rejects `12345`, `01212345678`; `null` clears; stored value is encrypted (raw doc has no plaintext).
- #4 photo: PDF named `.png` → `FILE_TYPE_NOT_ALLOWED`; 2.1 MB → `FILE_TOO_LARGE`; valid PNG → 202 pending, old photo still served until scan; clean scan promotes and deletes old; infected never becomes `photo_file_id` and flags the user; scanner down → retried, photo stays pending; anonymous `GET /users/:id/photo` → 401.
- #5 email change: old email still signs in before confirm, only new after; old address gets notice (outbox); `email_bouncing` cleared; expired (24 h 1 min) and reused link → `TOKEN_INVALID`; domain not allowed → 400; email taken at request → `CONFLICT`; taken between request and confirm → `CONFLICT`; 4th request in an hour → `RATE_LIMITED`.
- #6 `/auth/me` returns `email_action_required` true/false.
- #7 public profile: teacher viewing a student has no `level/term/section/group/phone/email` keys; `Object.keys` whitelist test.
- #8 audit rows for all four actions contain no phone/email values.
- #9 `email_unverified` → `403 STATE_NOT_ALLOWED` on `GET`/`PATCH /me/profile`, photo, email; allowed in `claim_pending`, `active`, `unconfirmed`, `graduated`, teacher `pending`.
- #2 `PATCH /me/profile` with `full_name` → `VALIDATION_ERROR`; student/teacher rename of self → `FORBIDDEN`; dept admin renames same-dept teacher → 200; super admin renames anyone.
- #1 own profile shape for student, teacher, CR (role present); email/phone returned to owner only.
- Cross-scope refusals: admin of dept A renames dept B teacher → `FORBIDDEN`; admin of dept A viewing dept B teacher's public profile → refused; pending teacher / deactivated viewer → `STATE_NOT_ALLOWED`; deactivated/unknown target → `NOT_FOUND`; request body `user_id` ignored on every `/me` route; roster/admin-list responses contain no email/phone (extend `privacy.test.js`).
- Concurrency (#5, #10): two simultaneous confirms of one token → one 200, one `TOKEN_INVALID`; two accounts both confirming a change to the same new address → exactly one succeeds, other `CONFLICT`; two photo uploads then both scans → only the latest becomes `photo_file_id`.
Shared: phone schema unit tests. Client (Vitest + Testing Library): ProfilePage render per kind, phone form validation messages, photo type/size precheck, change-email flow, banner shows/hides, confirm landing states, public profile has no private fields. One Playwright spec only if you ask.

## Build order (tests with code at each step)

1. Shared: phone/profile schemas, new error codes (+ unit tests).
2. User model fields, `auth.policy.js` profile policies, `registerProfileExtras`, `getOwnProfile`, `GET/PATCH /me/profile` with phone encryption + audit; `/auth/me` flag (tests #1,#2,#3,#6,#8,#9).
3. Public profile `toPublic`, `GET /users/:id`, admin rename (tests #2,#7, cross-scope).
4. `imageType`, `gridfs`, `clamav` libs; upload/delete, `photo.scan` job, serve endpoint, config + errors (tests #4).
5. Email change request/confirm, templates + i18n (tests #5 incl. concurrency).
6. Client api/hooks/components/pages, banner, nav, i18n (client tests).
7. Update spec file (raw upload decision, status), `/run-checks`, final checklist.

## Out of scope

Join form fields and student academic data (spec 10), teacher short-code linking (spec 06), bounce detection and webhook (spec 15; only the flag is read), password change (spec 01), department/section/semester name lookups (specs 03/04/09), image resizing, chat search and chat policies (spec 20), user-created sharing of phone/email, e2e Playwright tests.

## Verification

`npm test`, `npm run lint`, `npm run build` from the repo root via the `run-checks` skill; then walk the checklist above and mark each item with its passing test.

## Departures from this plan (made during the build)

1. **Public profile viewers.** The plan's cross-scope test "admin of dept A viewing a dept B teacher's public profile → refused" was wrong: PRF-07 lets every chat-enabled account view any public profile. The real scope rule is on hidden accounts: a viewer who is not an admin of that department gets `NOT_FOUND` for a `pending`, `deactivated` or `email_unverified` account. Tested in `publicProfile.api.test.js`.
2. **Photo "too large" mapping** lives in `profile.routes.js` (a wrapper around `express.raw`), not in `lib/errors.js`, so the global error handler is unchanged.
3. **`email_action_required`** is a top-level field of `GET /api/auth/me` (next to `next`), and `email_bouncing` stays inside `user`.
4. **Public profile shape** is `{ id, full_name, photo_url, department_id, roles }`. Own-profile photo is `{ url, status: 'none'|'pending'|'clean'|'rejected' }`.
5. **"Failed scan tells the user"** is shown on the profile (status `rejected`, from `photo_scan_failed_at`). No email template was added for it.
6. **Test files:** rename tests live in `publicProfile.api.test.js` (no separate `rename.api.test.js`); the harness helper is `drainPhotoScans()`; `app.test.js` (FND-11) was updated for the two new error codes; `privacy.test.js` got one extra assertion.
7. **Spec 02** was updated: raw upload instead of multipart, ClamAV client, null-until-later-specs, `email_action_required` placement, status Done, tasks ticked.
