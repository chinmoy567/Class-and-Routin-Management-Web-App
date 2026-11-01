# Plan: spec 01 — Auth and accounts

Spec: `.claude/specs/01-auth-accounts.md` (the only match for `01-auth`; specs live in `.claude/specs/`, not `specs/`).
Save target after approval: `implementation-plan/01-auth-accounts-plan.md`.

## Goal

People can sign up as a student or teacher with a `baiust.ac.bd` email, verify it, sign in, recover or change their password, and stay signed in under the right session rules. Accounts holding `super_admin` or `dept_admin` must also pass a second step (TOTP, with an emailed code as fallback) at every sign-in. `GET /api/auth/me` returns `next`, the screen the account state sends the person to, and the client route guard follows it. A super admin manages the allowed email domains. It builds on the finished foundation (spec 00): config, crypto, `withTransaction`, `can()`, audit, mail queue, CSRF, Mongo rate-limit store, test harness.

## Decisions already made with you

- **CAPTCHA:** self-hosted. I will use a **proof-of-work challenge** (server issues a random prefix and a bit-difficulty; the browser finds a solution with `crypto.subtle`; single-use, 5-minute, stored in MongoDB). It needs no image or third party and nothing for the user to solve, which helps WCAG. A pluggable `verifyCaptcha()` keeps a later swap to Turnstile easy.
- **TOTP:** written in-house on `node:crypto` (RFC 6238, 6 digits, 30 s, ±1 step). Only new dependency for QR: **`qrcode` in `client/`**. The server returns `{ otpauth_url, secret }`; the client draws the QR.
- **Departments:** `organisation` exports `isActiveDepartment(id)`. It is a stub that accepts any id until spec 03 replaces it with the real lookup. Tests inject a fake.
- Adding **`argon2`** to `server/` is in `tech-stack.md`, so no approval is needed.

## Blockers / open questions

- **Open (PRD Q1, university mail accepts the sender):** blocks launch, not development. Dev and test use the in-memory outbox.
- **Spec 10 join requests don't exist yet.** `next` must tell `join-form` from `waiting-approval` for a `claim_pending` student. I will add a small provider hook, `registerOpenJoinRequestCheck(fn)`, defaulting to "no open request". Spec 10 registers the real one.
- **Spec 04 semesters don't exist yet.** "Roles in effect" is the current `user_role` rows as the foundation already loads them. Semester filtering for CR/DCR comes with spec 04/09.
- Nothing else is blocked.

## Assumptions and departures from the spec (I will update the spec file first, per the README rule)

1. `user.name` is renamed to **`full_name`** (spec Data section). The foundation used `name`; this touches the seed, the factories and `seed.test.js` only.
2. The foundation's `reset_token_hash` / `reset_token_expires` on `user` are removed. The seed now creates a `one_time_token` (`reset_password`, 24 h) instead.
3. Allowed domains keep the existing `allowed_domain` collection and `AllowedDomain` model in `organisation` (spec calls it `allowed_email_domain`). The `/api/admin/email-domains` routes live in `organisation`, not `auth`, because the module owns the data.
4. **Throttle keys use `email_hmac`, not `user_id`** (`acct:<email_hmac>`), so a wrong password for an unknown email throttles exactly like a known one and a `429` never reveals who has an account. The same applies to the resend and reset limits (AUTH-11, AUTH-25): they are keyed by `email_hmac`.
5. `login_throttle` gets extra fields for the 1-hour rule: `hour_fails`, `hour_started_at`, `notified_at`.
6. New endpoint `GET /api/auth/captcha` → `{ id, prefix, bits }`. Login's `captcha` body field is `{ id, solution }`. `CAPTCHA_REQUIRED` is `403`.
7. New error codes in `shared/errors.js`: `EMAIL_DOMAIN_NOT_ALLOWED` (400), `INVALID_CREDENTIALS` (401), `ACCOUNT_DISABLED` (403), `CAPTCHA_REQUIRED` (403), `TOKEN_INVALID` (400), `CODE_INVALID` (400), `LAST_DOMAIN` (409).
8. Signing in as `email_unverified` succeeds with `next: 'verify-email'` (PRD "What each state can use" table), not the old sequence diagram's `403`.
9. Change password is allowed in every signable state except `email_unverified` (the table gives that state no profile editing).
10. `POST /verify` returns the `next` for the account's new state. It does not sign anyone in.
11. `/me` returns `full_name`, `kind`, `state`, `email_verified`, `email_bouncing`, roles and `next`. It does **not** return email or phone. Spec 02's profile endpoint returns them to the owner.
12. Admin per-session idle and absolute limits are enforced by the server against `clock.now()` (stored `lastSeenAt`, `signedInAt`) and not only by Mongo TTL, so they can be tested with the fixed clock.

## Rules and acceptance criteria checklist

Numbers are the spec's AUTH IDs. `[A]` marks a spec acceptance test.

1. **AUTH-01** `kind` and exactly one `state`; allowed states per kind.
2. **AUTH-02** One email, one account (unique `email_hmac`).
3. **AUTH-03** Email and phone only encrypted; never returned except to the owner.
4. **AUTH-04** Sign-up fields; teacher gives an active department and a 1–10 letter short code, upper-cased.
5. **AUTH-05** Domain must be on the allowed list, no subdomains: `400 EMAIL_DOMAIN_NOT_ALLOWED`. [A] `x@gmail.com` → 400, `x@baiust.ac.bd` → 202.
6. **AUTH-06** Password 8–128 chars, a letter and a number, argon2id.
7. **AUTH-07** New account `email_unverified`; verification email; link 24 h, once.
8. **AUTH-08** Existing email → same 202 and an `already_registered` email; never reveals registration. [A] twice with the same email: same response, one account.
9. **AUTH-09** Sign-up limited to 5/hour/IP.
10. **AUTH-10** Valid link: student → `claim_pending`, teacher → `pending`; expired/used → `TOKEN_INVALID`. [A] verified student/teacher states; link used at 24 h 1 min → `TOKEN_INVALID`; second use → `TOKEN_INVALID`.
11. **AUTH-11** Resend limited to 3/hour per account; a new link cancels old ones.
12. **AUTH-12** Wrong email and wrong password give the same `401 INVALID_CREDENTIALS`. [A] identical bodies.
13. **AUTH-13** `deactivated` / `suspended` → `403 ACCOUNT_DISABLED`, no detail.
14. **AUTH-14** After 5 failures in 15 min: waits 1 s, 2 s, 4 s … 5 min (`429` + `Retry-After`), CAPTCHA required, never locked, success resets the account counter. [A] 6th try needs CAPTCHA and waits 1 s; correct password works after the wait.
15. **AUTH-15** 10 failures on one account in an hour → one email, at most once an hour.
16. **AUTH-16** Session id regenerated after a good password check.
17. **AUTH-17** Admin session is `second_step_pending`; every other endpoint → `401 SECOND_STEP_REQUIRED`. [A] dept admin without the second step gets 401 on `GET /api/rooms`.
18. **AUTH-18** TOTP 6 digits / 30 s / ±1 step; secret stored encrypted; setup screen (QR + manual key) after the password if not set up; confirm with a valid code.
19. **AUTH-19** Emailed code: 6 digits, 10 min, once, at most 3 per 15 min. [A] works once, fails after 10 min.
20. **AUTH-20** 5 wrong second-step codes in a row end the half-signed-in session.
21. **AUTH-21** Sessions in MongoDB (connect-mongo); HTTP-only, Secure (production), SameSite=Lax cookie.
22. **AUTH-22** Student/teacher: 14 days idle (rolling). Admin: 30 min idle or 12 h total. [A] admin idle 31 min → `UNAUTHENTICATED`; student idle 13 days still works.
23. **AUTH-23** Sessions record `user_id`; password change/reset or deactivate/suspend deletes all sessions of the account (password change keeps the current one). [A] after a reset another browser's session → `UNAUTHENTICATED`.
24. **AUTH-24** State and roles loaded fresh every request. [A] admin role removed mid-session stops working on the next request.
25. **AUTH-25** Forgot password: always the same 202; link 1 h, once; 3/hour per account, 10/hour per IP.
26. **AUTH-26** Reset sets the new hash, ends all sessions, emails `password_changed`.
27. **AUTH-27** Signed-in password change needs the current password; AUTH-23 applies.
28. **AUTH-28** Super admin lists/adds/removes allowed domains; at least one remains; each change audited.
29. **AUTH-29** `GET /api/auth/me` → `{ user, roles, next }`. [A] `next` correct for each state.
30. **Privacy/security from CLAUDE.md:** CSRF on every state-changing call (already global); no email/phone/token/code in logs or responses; admin accounts need the second step every sign-in; first-action-wins and one-time tokens via conditional updates.
31. **Permissions table:** anyone for sign-up/verify/sign-in/forgot; any signed-in signable account for change password, sign out, `/me`; super admin only for domains.

## Files

**shared/**
- `errors.js` — add the seven codes (item 7 above).
- `enums.js` — add `NEXT_SCREENS`, `TOKEN_PURPOSES`, `ADMIN_ROLES`.
- `schemas/auth.js` — `passwordSchema`, `signupBody`, `loginBody`, `verifyBody`, `resendBody`, `secondStepBody`, `resetRequestBody`, `resetConfirmBody`, `changePasswordBody`, `domainBody`. Exported from `schemas/index.js`.

**server/src/modules/auth/**
- `auth.model.js` — extend `User`; add `OneTimeToken`, `LoginThrottle`, `CaptchaChallenge`.
- `auth.schemas.js` — re-exports the shared schemas for `validate()`.
- `auth.policy.js` — `account.view_me`, `account.change_password`.
- `auth.service.js` — keeps `loadRequestUser`, `getEmailAddress`, `seedSuperAdmin` (seed changed per item 2). Add: `signUp`, `verifyEmail`, `resendVerification`, `logIn`, `logOut`, `requestPasswordReset`, `confirmPasswordReset`, `changePassword`, `getMe`.
- `tokens.service.js` — create/consume one-time tokens (`hashToken`), cancel older tokens.
- `throttle.service.js` — atomic per-key counters, backoff, hour counter, owner-alert gate.
- `captcha.service.js` — issue and verify proof-of-work challenges.
- `secondStep.service.js` — TOTP setup/confirm/verify, emailed code, 5-strike lockout.
- `sessions.js` — `establishSession` (regenerate), `endAllSessions(userId, { exceptSid })`, `ensureSessionIndex()`, `enforceSessionLifetime` and `secondStepGate` middleware.
- `next.js` — pure `nextScreen(user, session)` and `registerOpenJoinRequestCheck`.
- `auth.controller.js`, `auth.routes.js` (adds `meRouter` for `/api/me/password`).
- `index.js` — exports only what other modules need: `endAllSessions`, `registerOpenJoinRequestCheck`, existing exports.
- `__tests__/` — see Tests.

**server/src/lib/**
- `totp.js` — base32, HOTP/TOTP, `verifyTotp(secret, code, now)`, `otpauthUrl`.
- `rateLimit.js` — `limitBy({ prefix, windowMs, limit, key })` built on the existing `MongoRateLimitStore`, plus `hit(key, windowMs)` for per-email counters.

**server/src/modules/organisation/**
- `organisation.model.js` — keep `AllowedDomain`; add `AllowedDomainGuard` (single-document serialiser).
- `organisation.service.js` — `listDomains`, `addDomain`, `removeDomain` (transaction + audit), `isActiveDepartment` (stub), existing `addAllowedDomain`, `isDomainAllowed`.
- `organisation.policy.js` — `email_domain.manage`.
- `organisation.controller.js`, `organisation.routes.js`, `organisation.schemas.js`, `index.js`.

**server/src/modules/notifications/**
- `templates/index.js` — add `verify_email`, `already_registered`, `reset_password`, `password_changed`, `failed_logins`, `second_step_code`.
- `server/src/i18n/en.json` — their subjects and bodies.

**server/src/**
- `app.js` — session options (`stringify: false`, rolling, per-role cookie age), mount order: session → csrf → `loadUser` → `enforceSessionLifetime` → `secondStepGate` → routers; mount `meRouter`, organisation router.
- `policy/index.js` — register the new policy sets (match the existing pattern).
- `server.js` — call `ensureSessionIndex()` on startup.
- `scripts/seed-super-admin.js` — unchanged call, new behaviour via the service.

**server/test/**
- `factories.js` — `makeUser` gains `password`, `totp`, `full_name`; add `makeOneTimeToken`.
- `harness.js` — import the new models; `loginAs` can mark a session as `second_step_pending`; `signInWithPassword(app, email, password)` helper that uses the real login route.

**client/**
- `package.json` — add `qrcode`.
- `src/features/auth/api.js`, `hooks.js` (`useMe`, mutations), `pow.js` (CAPTCHA solver), `components/`.
- `src/routes/`: `SignUpPage`, `CheckEmailPage`, `VerifyPage`, `SignInPage`, `SecondStepPage`, `TotpSetupPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `ChangePasswordPage`, plus minimal holding pages for `join-form`, `waiting-approval`, `semester-update` (each shows its text and a sign-out button; later specs replace them).
- `src/components/AuthGate.jsx` — route guard that follows `me.next`.
- `src/App.jsx` — route tree; `src/lib/query-keys.js` — `qk.me`, `qk.emailDomains`.
- `src/i18n/en.json` — all strings, including `errors.<CODE>` for the new codes.
- shadcn `form`, `input`, `label` components as needed (already in the stack).

## Data model

- **`user`** (collection `user`): `kind`, `state`, `full_name`, `email_enc` (select:false), `email_hmac` (unique), `email_verified_at`, `email_bouncing` (default false), `phone_enc?` (select:false), `photo_file_id?`, `password_hash` (select:false), `password_changed_at`, `totp_secret_enc?` (select:false), `totp_enabled_at?`, `department_id?`, `requested_short_code?`, `chat_suspended_until`, timestamps. Indexes: unique `email_hmac`.
- **`one_time_token`**: `user_id`, `purpose` (`verify_email` | `reset_password` | `second_step` | `change_email`), `token_hash` (unique), `payload?`, `expires_at` (TTL, `expireAfterSeconds: 0`), `used_at?`. Index `{ user_id, purpose }`. Second-step codes hash `userId:code` so the unique index never clashes between users. Consumption is `findOneAndUpdate({ token_hash, purpose, used_at: null, expires_at: { $gt: now } }, { $set: { used_at } })`. If nothing matches → `TOKEN_INVALID`/`CODE_INVALID`. TTL is lazy, so `expires_at` is always checked in the query.
- **`login_throttle`**: `key` (unique; `acct:<email_hmac>` or `ip:<ip>`), `fails`, `first_fail_at`, `next_allowed_at`, `hour_fails`, `hour_started_at`, `notified_at?`, `updated_at` with a TTL index of 1 day. Updates are single atomic pipeline updates (same technique as `MongoRateLimitStore`), so concurrent failures never lose counts.
- **`captcha_challenge`**: `prefix`, `bits`, `expires_at` (TTL), `used_at?`. Single use via conditional update.
- **`allowed_domain`**: existing, unique `domain`. **`allowed_domain_guard`**: one document `{ _id: 'allowed_domain' , version }`.
- **`sessions`** (connect-mongo, `stringify: false`): each document keeps `session.userId` as a string. Index `{ 'session.userId': 1 }` created at startup (and in the test harness).
- **Transactions:** sign-up (user + verify token + enqueue after commit), verify (consume token + set state), reset confirm (consume token + set hash), domain add/remove (guard write + change + audit), seed.
- **First action wins:** token consumption (verify, reset, second-step code) and CAPTCHA use are the conditional updates above. Concurrent sign-ups on one email rely on the unique `email_hmac` index; the loser is treated as "already registered".
- **No last domain:** `removeDomain` first `$inc`s the guard document inside the transaction. Two concurrent removals then write-conflict and one retries, sees one domain left, and fails with `LAST_DOMAIN` (mongo-patterns §6 technique).
- Emails and sockets go out **after** the commit (`afterCommit`).

## API

All under `/api`, responses `{ data }` / `{ error: { code, message, fields? } }`. Every non-GET needs the CSRF header (already global).

| Endpoint | Who / `can()` | Zod | Notes and audit |
|---|---|---|---|
| `GET /auth/csrf` | anyone | none | exists |
| `GET /auth/captcha` | anyone | none | new; IP rate limited |
| `POST /auth/signup` | anyone; limit 5/h/IP | `signupBody` | 202 same body for new and existing email; `EMAIL_DOMAIN_NOT_ALLOWED`; teacher needs active department; both paths do the same argon2 work |
| `POST /auth/verify` | anyone | `verifyBody` | consume token, set state; `TOKEN_INVALID` |
| `POST /auth/verify/resend` | anyone; 3/h per `email_hmac` | `resendBody` | always 202 for valid input; only an `email_unverified` account gets a mail; cancels old tokens |
| `POST /auth/login` | anyone | `loginBody` | throttle (account + IP), CAPTCHA once required, constant-shape errors, dummy hash for unknown email, regenerate session, admin → `second_step_pending`; `ACCOUNT_DISABLED`; returns `{ next }`; failed-login owner email |
| `POST /auth/second-step` | half-signed-in admin | `secondStepBody` | TOTP or emailed code; 5 strikes destroys the session |
| `POST /auth/second-step/email-code` | half-signed-in admin; 3/15 min | none | new code cancels older ones |
| `POST /auth/totp/setup` | half-signed-in admin, no TOTP yet | none | returns `{ otpauth_url, secret }`; `CONFLICT` if TOTP already on |
| `POST /auth/totp/confirm` | same | `secondStepBody` | sets `totp_enabled_at`, clears pending |
| `POST /auth/logout` | signed in (any signable state, incl. half-signed-in) | none | 204, destroys the session |
| `POST /auth/reset/request` | anyone; 3/h per `email_hmac`, 10/h per IP | `resetRequestBody` | always 202 |
| `POST /auth/reset/confirm` | anyone | `resetConfirmBody` | new hash, `password_changed_at`, end all sessions, `password_changed` email |
| `POST /me/password` | `account.change_password` (not `email_unverified`) | `changePasswordBody` | `INVALID_CREDENTIALS`; ends other sessions; email |
| `GET /auth/me` | `account.view_me` | none | `{ user, roles, next }` |
| `GET/POST/DELETE /admin/email-domains[/:domain]` | `email_domain.manage` = `active` super admin | `domainBody` | **audit** `allowed_domain.add` / `allowed_domain.remove` inside the transaction; `CONFLICT`, `LAST_DOMAIN` |

Cross-cutting middleware: `enforceSessionLifetime` (idle/absolute limits against `clock.now()`, also drops sessions of `deactivated`/`suspended` accounts) and `secondStepGate` (everything except `/auth/csrf`, `/auth/captcha`, `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/second-step*`, `/auth/totp/*` returns `401 SECOND_STEP_REQUIRED` for a half-signed-in session). Responses are built with `toPublicUser()`, never from Mongoose documents.

## UI

- Pages: Sign up (student/teacher toggle; teacher adds department and short code), Check your email, Verify (landing from the link; expired → "Send a new link"), Sign in (shows the CAPTCHA step only after the server says it's required; shows the wait time on `RATE_LIMITED`), Second step (code + "email me a code"), TOTP setup (QR via `qrcode` + manual key + confirm code), Forgot password, Reset password, Change password (route `/account/password`, linked from the profile later).
- `AuthGate` calls `useMe()`: `401` → `/login`; otherwise navigates to the screen for `me.next` (`verify-email`, `second-step`, `setup-totp`, `join-form`, `waiting-approval`, `semester-update`, `dashboard` → `/`).
- Forms: React Hook Form + `zodResolver` with the shared schemas; submit disabled while pending; server `fields` mapped to `setError`; visible labels; ≥44 px targets; 360 px first; `aria-live="polite"` for errors.
- Translation keys (all in `client/src/i18n/en.json`): `auth.signup.*`, `auth.checkEmail.*`, `auth.verify.*`, `auth.login.*`, `auth.secondStep.*`, `auth.totp.*`, `auth.forgot.*`, `auth.reset.*`, `auth.changePassword.*`, `auth.next.*` (holding pages), `errors.INVALID_CREDENTIALS`, `errors.EMAIL_DOMAIN_NOT_ALLOWED`, `errors.ACCOUNT_DISABLED`, `errors.CAPTCHA_REQUIRED`, `errors.TOKEN_INVALID`, `errors.CODE_INVALID`, `errors.LAST_DOMAIN`, `errors.RATE_LIMITED` (with retry seconds).
- Account-state screens: `verify-email` shows "check your inbox" with resend; the three holding pages show their text and sign out.
- The domain-management admin screen is **not** built (spec 18's admin dashboard); only the API.

## Tests

Server tests use the in-memory replica set and the fixed clock. Names start with the AUTH ID.

`auth/__tests__/signup.api.test.js` — AUTH-04 (teacher needs department + code, short code upper-cased, bad lengths 400), AUTH-05 [A], AUTH-06 (7 chars, no digit, 129 chars → 400; stored hash starts `$argon2id$`), AUTH-07 (state, email in outbox, token expiry 24 h), AUTH-08 [A] (+ `already_registered` mail; concurrent `Promise.all` sign-ups → one user), AUTH-09 (6th sign-up from one IP → 429), AUTH-02, AUTH-03 (no `email_enc`/`email_hmac`/`password_hash` in any response; stored value is ciphertext), AUTH-01.

`auth/__tests__/verify.api.test.js` — AUTH-10 [A] (student, teacher, 24 h 1 min, second use, concurrent double use → one success), AUTH-11 (4th resend in an hour → 429; new link cancels the old one).

`auth/__tests__/login.api.test.js` — AUTH-12 [A], AUTH-13 (both states, no extra detail), AUTH-14 [A] (CAPTCHA, 1 s wait with `Retry-After`, success after the wait resets the counter, never locked; 20 concurrent bad tries count exactly 20), AUTH-15 (one mail at 10, none again within the hour, again after it), AUTH-16 (session id differs before and after login), AUTH-21 (cookie flags), `email_unverified` signs in with `next: verify-email`.

`auth/__tests__/captcha.test.js` — wrong solution, expired, reused, and valid solution accepted; counts toward AUTH-14.

`auth/__tests__/secondStep.api.test.js` — AUTH-17 [A], AUTH-18 (setup then confirm; secret stored encrypted; RFC 6238 test vectors for `lib/totp.js`; ±1 step accepted, ±2 rejected), AUTH-19 [A] (once, 10 min, 4th code in 15 min → 429, new code cancels old, concurrent use → one success), AUTH-20 (5 wrong codes end the session), setup refused when TOTP already enabled.

`auth/__tests__/sessions.api.test.js` — AUTH-22 [A] (admin idle 31 min; admin 12 h absolute even if active; student idle 13 days works; 15 days fails), AUTH-23 [A] (reset and change password; change keeps current session; deactivated account's sessions removed), AUTH-24 [A] (admin role removed; state changed to `deactivated`).

`auth/__tests__/recovery.api.test.js` — AUTH-25 (same body for unknown and known email, 4th per email → 429, 11th per IP → 429, link expiry 1 h, single use, concurrent use → one wins), AUTH-26 (hash changed, sessions ended, mail sent), AUTH-27 (wrong current password → `INVALID_CREDENTIALS`, `email_unverified` → `STATE_NOT_ALLOWED`).

`auth/__tests__/me.api.test.js` — AUTH-29 [A] (one case per `next` value: `verify-email`, `second-step`, `setup-totp`, `join-form`, `waiting-approval` for a teacher `pending` and for a student with a stubbed open request, `semester-update`, `dashboard` for `active`/`graduated`/staff), no email/phone in the body.

`organisation/__tests__/domains.api.test.js` — AUTH-28 (list/add/remove, duplicate → `CONFLICT`, last one → `LAST_DOMAIN`, **concurrent removal of the two remaining domains leaves one**, audit entry per change, normalised lower-case). **Cross-scope refusals:** student, teacher, `dept_admin` of any department, a super admin who has not passed the second step, and an anonymous caller all refused (403 / 401 `SECOND_STEP_REQUIRED` / 401).

`auth/__tests__/seed.test.js` (updated) — the seed creates a `reset_password` one-time token; refusing twice still holds.

`auth/__tests__/privacy.test.js` — logs never contain the email, password, token or code (capture the pino stream across the flows).

Client (Vitest + Testing Library): sign-up form validation and teacher-only fields; sign-in shows wait time and then the CAPTCHA step; `pow.js` solves a known challenge; second-step and TOTP-setup forms; `AuthGate` routes each `next` to the right path and `401` to `/login`; `errors.*` mapping. Strings come from `en.json` (a test fails on a missing key).

Playwright: not added in this spec (the main journey needs spec 10). The existing smoke test must still pass.

Traceability: every `it()` begins with its AUTH ID, and the final report lists each checklist item against its test.

## Build order (tests written together with the code)

1. Update the spec file (captcha endpoint, extra throttle fields, resolved decisions, the departures above). Add `argon2` (server) and `qrcode` (client); `npm install`.
2. Shared: error codes, enums, Zod schemas + schema tests.
3. Models (user rename, tokens, throttle, captcha, guard) and the factories/harness changes; rewrite the seed and fix `seed.test.js`. Run existing suites to confirm the foundation still passes.
4. `lib/totp.js` and `lib/rateLimit.js` with unit tests.
5. Mail templates and server i18n for the six emails.
6. Sign-up, verify, resend (service, routes, tests).
7. Throttle + CAPTCHA + login + failed-login mail (tests).
8. Sessions: connect-mongo options, `establishSession`, lifetime and second-step-gate middleware, `endAllSessions`, session index (tests incl. AUTH-22/23/24).
9. Second step: TOTP setup/confirm, code check, email fallback, lockout (tests).
10. Forgot/reset/change password, logout (tests).
11. `/auth/me`, `nextScreen`, the join-request hook, policies (tests).
12. Organisation: domains service/routes/policy/audit/guard (tests, including the concurrent removal).
13. Client: query keys, api/hooks, i18n, pages, `AuthGate`, `pow.js`, component tests.
14. Run `run-checks` (lint, tests, build); fix failures; walk the checklist; report. No commit unless you ask.

## Out of scope

Join form and UV ID claim (spec 10); teacher approval and short-code linking (spec 06); granting/removing admin roles and the reset of a lost TOTP/password by another admin (spec 03); changing email, phone, photo and the profile page (spec 02); the admin screen for allowed domains (spec 18); real department lookup (spec 03); semester-scoped roles (specs 04/09); full email catalogue, batching, bounces (spec 15); Turnstile/hCaptcha; replay protection for used TOTP codes; throttling the current-password check on `/me/password`; Playwright journeys; commits.

## Verification

- `npm test` (server, client, shared), `npm run lint`, `npm run build`, `npm run format:check` from the repo root via the `run-checks` skill.
- Manual check with `npm run dev:server` + `npm run dev:client`: seed a super admin, sign up a student, read the verification link from the dev outbox, sign in, trigger throttling and CAPTCHA, set up TOTP for the super admin, reset a password.

## Implementation notes (departures from this plan)

- The fifth wrong second-step code answers `401 UNAUTHENTICATED` (the session has ended), not `CODE_INVALID`; codes 1 to 4 answer `CODE_INVALID`.
- `second-step` and `email-code` answer `409 CONFLICT` until the authenticator is set up (the email fallback needs an enabled authenticator).
- The organisation router is mounted in `app.js` behind `requireAuth` (avoids an import cycle with auth).
- The signed-in "verify-email" screen asks the person to type their email to get a new link, because `/me` never returns the address.
- Teacher sign-up reads the department list from `GET /api/departments`, which spec 03 will provide; until then the select is empty and shows a notice.
- `auth/privacy.test.js` is a static check (no logger/console calls in the auth module) plus field-selection checks; log redaction itself is covered by FND-30.
- Existing foundation tests changed: `app.test.js` (error-code list), `db.test.js` and `seed.test.js` (`name` is now `full_name`, seed token), client `AppShell.test.jsx` (needs a signed-in user).
