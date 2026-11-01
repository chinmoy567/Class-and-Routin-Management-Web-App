# 01: Auth and accounts

R1 · Status: Done · Depends on: 00 · PRD: Users & roles, Account states and access, Authentication & onboarding, Non-functional requirements (Security, Stored data) · Diagrams: 17-seq-auth-login, 19-state-account

## Goal

People can create a student or teacher account with a university email, verify it, sign in, recover their password and stay signed in safely. Admins also pass a second step. The account state decides where each person lands.

## Scope

**In:** sign-up (student, teacher), email verification, sign-in, throttling and CAPTCHA, second step (TOTP plus an emailed code as fallback), sessions and timeouts, sign-out, password reset, password change, allowed email domains, the `/me` endpoint, routing by account state.

**Out:** the join form and UV ID claim (spec 10), teacher approval (spec 06), granting admin roles (spec 03), changing your email and profile fields (spec 02).

## Requirements

### Accounts and states
- **AUTH-01** A `user` has `kind` = `student` | `teacher` | `staff` and exactly one `state`. Student states: `email_unverified`, `claim_pending`, `active`, `unconfirmed`, `graduated`, `deactivated`. Teacher states: `email_unverified`, `pending`, `active`, `suspended`, `deactivated`. Staff (an admin who doesn't teach): `active`, `deactivated`.
- **AUTH-02** One email belongs to exactly one account (unique `email_hmac`). One person has one account, which can hold several roles.
- **AUTH-03** Email and phone are stored only encrypted (`email_enc`, `phone_enc`), and `email_hmac` is used for lookups. Neither field is ever returned except to the owner (and the two exceptions in spec 06 and spec 10).

### Sign-up
- **AUTH-04** Sign-up asks for kind (student or teacher), full name, email and password. A teacher also gives a department (from the active department list) and a short code (1–10 letters, upper-cased).
- **AUTH-05** The email domain must be on the allowed list (starting with `baiust.ac.bd`). Otherwise the server returns `400 EMAIL_DOMAIN_NOT_ALLOWED`. Subdomains are not allowed unless listed.
- **AUTH-06** The password has at least 8 characters, with at least one letter and one number, and at most 128 characters. It is hashed with argon2id.
- **AUTH-07** The new account is `email_unverified` and a verification email is sent. The link lasts 24 hours and works once.
- **AUTH-08** If the email already belongs to an account, the response is the same "check your email" success, and that address gets an "you already have an account" email instead. Sign-up never reveals whether an email is registered.
- **AUTH-09** Sign-up is rate limited to 5 per hour per IP.

### Verification
- **AUTH-10** Opening a valid verification link marks the email verified and moves the account: student → `claim_pending`, teacher → `pending`. An expired or used link shows "link expired" with a button to send a new one.
- **AUTH-11** "Resend verification" is limited to 3 per hour per account, and each new link cancels the old ones.

### Sign-in
- **AUTH-12** Sign-in takes email and password. A wrong email and a wrong password give the same `401 INVALID_CREDENTIALS`.
- **AUTH-13** `deactivated` and `suspended` accounts can't sign in: `403 ACCOUNT_DISABLED`, with no further detail.
- **AUTH-14** Throttling is counted per account and per IP. After 5 failed tries in 15 minutes, each new try must wait 1 s, 2 s, 4 s … up to 5 minutes (`429 RATE_LIMITED` with `Retry-After`), and a CAPTCHA is required. The account is never locked outright. A successful sign-in resets the account's counter.
- **AUTH-15** After 10 failed tries on one account within an hour, the owner gets one email about it (at most once per hour).
- **AUTH-16** After a successful password check, the server regenerates the session id (no session fixation).

### Second step (admins)
- **AUTH-17** An account holding `super_admin` or `dept_admin` must pass the second step at every sign-in. Until then the session is marked `second_step_pending` and every other endpoint returns `401 SECOND_STEP_REQUIRED`.
- **AUTH-18** The second step is a TOTP code from an authenticator app (6 digits, 30-second step, ±1 step allowed). The TOTP secret is stored encrypted. An admin without TOTP set up is shown the setup screen (QR code plus manual key) right after the password, and confirms it with a valid code.
- **AUTH-19** Fallback: "email me a code" sends a 6-digit code that lasts 10 minutes and works once. At most 3 codes per 15 minutes.
- **AUTH-20** 5 wrong second-step codes in a row end the half-signed-in session. The admin starts again from the password.

### Sessions
- **AUTH-21** Sessions are stored in MongoDB (connect-mongo) in an HTTP-only, Secure, SameSite=Lax cookie.
- **AUTH-22** A student or teacher session ends after 14 days without use (rolling). An admin session ends after 30 minutes idle or 12 hours in total, whichever comes first.
- **AUTH-23** Each session records `user_id`. When the password changes, or the account is deactivated or suspended, every session of that account is deleted (except, for a password change, the current one).
- **AUTH-24** On every request the user's current state and roles are loaded fresh from the database, so a state or role change takes effect at once.

### Recovery
- **AUTH-25** "Forgot password" takes an email and always answers the same "if the account exists, we sent a link". The link lasts 1 hour and works once. It is limited to 3 per hour per account and 10 per hour per IP.
- **AUTH-26** Resetting the password sets the new hash, ends all sessions of the account, and emails the owner that the password changed.
- **AUTH-27** A signed-in user can change their password by giving the current one. AUTH-23 applies.

### Allowed domains
- **AUTH-28** A super admin can list, add and remove allowed email domains. At least one must remain. Each change is audited.

### Where people land
- **AUTH-29** `GET /api/auth/me` returns the user's public profile, kind, state, roles in effect, and `next` = the screen to show: `verify-email`, `second-step`, `setup-totp`, `join-form` (`claim_pending` with no open request), `waiting-approval` (`claim_pending` with an open request, or a `pending` teacher), `semester-update` (`unconfirmed`), or `dashboard`.

## Permissions

| Action | Who |
|---|---|
| Sign up, verify, sign in, forgot password | Anyone (rate limited) |
| Change password, sign out, `/me` | Any signed-in account in any state that can sign in |
| Manage allowed domains | Super admin |

## Data

- `user`: kind, state, full_name, `email_enc`, `email_hmac` (unique), `email_verified_at`, `email_bouncing` (bool), `phone_enc?`, `photo_file_id?`, `password_hash`, `password_changed_at`, `totp_secret_enc?`, `totp_enabled_at?`, `department_id?` (teacher's registration department), `requested_short_code?` (teacher), `created_at`, `updated_at`. `email_enc`, `phone_enc`, `password_hash` and `totp_secret_enc` are `select: false`.
- `one_time_token`: user_id, purpose (`verify_email` | `reset_password` | `second_step` | `change_email`), `token_hash` (unique), `payload?` (for example the new email for `change_email`), expires_at (TTL index), used_at?.
- `login_throttle`: key (`acct:<email_hmac>` or `ip:<ip>`; the account key uses the email HMAC so an unknown email throttles like a known one), fails, first_fail_at, next_allowed_at, hour_fails, hour_started_at, notified_at?, updated_at. TTL index 1 day after the last update.
- `captcha_challenge`: prefix, bits, expires_at (TTL), used_at?. A self-hosted proof-of-work challenge, single use.
- `allowed_domain` (organisation module): domain (unique, lower-case), plus a one-document `allowed_domain_guard` that serialises removals so the last domain can never be removed.
- `sessions` (connect-mongo) with `user_id` stored so all of an account's sessions can be found (AUTH-23).

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/auth/csrf` | anyone | none | `{ token }` | none |
| `GET /api/auth/captcha` | anyone | none | `{ id, prefix, bits }` | `RATE_LIMITED` |
| `POST /api/auth/signup` | anyone | kind, full_name, email, password, department_id?, short_code? | 202 "check your email" | `VALIDATION_ERROR`, `EMAIL_DOMAIN_NOT_ALLOWED`, `RATE_LIMITED` |
| `POST /api/auth/verify` | anyone | token | 200 `{ next }` | `TOKEN_INVALID` (expired or used) |
| `POST /api/auth/verify/resend` | anyone | email | 202 | `RATE_LIMITED` |
| `POST /api/auth/login` | anyone | email, password, captcha? (`{ id, solution }`) | 200 `{ next }` | `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`, `CAPTCHA_REQUIRED` (403), `RATE_LIMITED` |
| `POST /api/auth/second-step` | half-signed-in admin | code | 200 `{ next }` | `CODE_INVALID`, `RATE_LIMITED` |
| `POST /api/auth/second-step/email-code` | half-signed-in admin | none | 202 | `RATE_LIMITED` |
| `POST /api/auth/totp/setup` | half-signed-in admin with no TOTP | none | `{ otpauth_url, secret }` | none |
| `POST /api/auth/totp/confirm` | same | code | 200 `{ next }` | `CODE_INVALID` |
| `POST /api/auth/logout` | signed in | none | 204 | none |
| `POST /api/auth/reset/request` | anyone | email | 202 | `RATE_LIMITED` |
| `POST /api/auth/reset/confirm` | anyone | token, password | 200 | `TOKEN_INVALID`, `VALIDATION_ERROR` |
| `POST /api/me/password` | signed in | current_password, new_password | 200 | `INVALID_CREDENTIALS`, `VALIDATION_ERROR` |
| `GET /api/auth/me` | signed in | none | `{ user, roles, next }` | `UNAUTHENTICATED` |
| `GET/POST/DELETE /api/admin/email-domains[/:domain]` | super admin | domain | list / 201 / 204 | `CONFLICT`, `LAST_DOMAIN` |

## Jobs and events

- None of its own. Emails go through `mail.enqueue` (templates `verify_email`, `already_registered`, `reset_password`, `password_changed`, `failed_logins`, `second_step_code`).
- Expired tokens and throttle records are removed by TTL indexes.

## Screens

Sign up (student/teacher toggle), Check your email, Verify (landing from the link), Sign in (with CAPTCHA once required), Second step (code + "email me a code"), TOTP setup, Forgot password, Reset password, Change password (in the profile). A route guard sends each state to its screen using `next`.

## Acceptance tests

- AUTH-05: sign-up with `x@gmail.com` → `400 EMAIL_DOMAIN_NOT_ALLOWED`. With `x@baiust.ac.bd` → 202.
- AUTH-08: signing up twice with the same email gives the same response both times, and only one account exists.
- AUTH-10: a verified student is `claim_pending`, and a verified teacher is `pending`.
- AUTH-10: a verification link used after 24 h 1 min → `TOKEN_INVALID`. Used twice → second use `TOKEN_INVALID`.
- AUTH-12: a wrong password and an unknown email return identical bodies.
- AUTH-14: after 5 failures the 6th try needs a CAPTCHA and waits 1 s. The account is still able to sign in with the correct password once the wait has passed.
- AUTH-17: a dept admin who passes the password but not the second step gets `401 SECOND_STEP_REQUIRED` on `GET /api/rooms`.
- AUTH-19: an emailed code works once, and fails after 10 minutes.
- AUTH-22: an admin session idle 31 minutes → `UNAUTHENTICATED`. A student session idle 13 days still works.
- AUTH-23: after a password reset, another browser's session gets `UNAUTHENTICATED`.
- AUTH-24: an admin role removed while a session is open stops working on the next request.
- AUTH-29: `next` is correct for each state in the table.

## Decisions and open questions

- **Decision:** sign-up answers the same way whether or not the email exists (AUTH-08). The PRD says the HMAC is used "to check that an address is not already taken". This spec does that check silently, to avoid revealing who has an account.
- **Decision (confirmed):** TOTP (RFC 6238) is written in-house on `node:crypto`. Only the `qrcode` package is added, in `client/`, to draw the setup QR. The server returns `{ otpauth_url, secret }`.
- **Decision (confirmed):** CAPTCHA is self-hosted: a proof-of-work challenge (`GET /api/auth/captcha`, solved in the browser, single use, 5 minutes). No third party. The verifier is one function, so Turnstile can replace it later.
- **Decision:** the foundation's `user.name` becomes `full_name`; its `reset_token_*` fields are replaced by `one_time_token`. Department existence at sign-up goes through `organisation.isActiveDepartment`, a stub until spec 03. `next` uses a hook (`registerOpenJoinRequestCheck`) for "open join request" until spec 10.
- **Decision:** resend and reset limits (AUTH-11, AUTH-25) are keyed by the email HMAC, so a `429` never reveals whether an address is registered.
- **Open (PRD Open question 1):** whether university mail accepts the sender. This blocks launch, not development.

## Tasks

- [x] `user`, `one_time_token`, `login_throttle`, `allowed_email_domain` models and indexes
- [x] Shared Zod schemas: signup, login, password rules
- [x] Sign-up + verification + resend (with the `already_registered` path)
- [x] Sign-in with throttling, CAPTCHA hook, failed-login email
- [x] Session config (rolling 14 days / admin 30 min idle + 12 h absolute), session-per-user index, "end all sessions" helper
- [x] Second step: TOTP setup and confirm, code check, email-code fallback, lockout after 5 wrong codes
- [x] Forgot and reset password, change password
- [x] Allowed domains admin endpoints + audit
- [x] `/api/auth/me` with `next`
- [x] Client screens and the route guard
- [x] Tests for every AUTH requirement
