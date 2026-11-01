---
description: Verify a finished spec (or all specs) against its requirements - unit, API, security, concurrency, traceability - and save the report to test-results/
argument-hint: <spec, e.g. 01 or 01-auth-accounts>  |  all
---

Verify what was built for: **$ARGUMENTS** (empty or `all` means every spec whose status is `In progress` or `Done`).

This is an audit, not a build. **Do not change source code, tests, config or specs.** Only write the report files under `test-results/`. Never weaken, skip or delete a test, and never add `eslint-disable`. If something fails, record it; fixing is a separate request.

## 1. Resolve the scope

- Resolve `$ARGUMENTS` to spec files in `.claude/specs/` (number, name or path). For `all`, take every spec except `README.md`. If a name matches nothing or more than one file, stop and ask.
- Create `test-results/<YYYY-MM-DD_HH-mm>_<spec-or-all>/` (use the current Asia/Dhaka time). Everything below is saved in that folder. Keep `test-results/` out of git only if the user asks.

## 2. Build the requirement list (the source of truth)

For each spec, read the whole file, then the PRD sections it lists in `DOCUMENTS/Class and Routine Management - PRD.md`, and `DOCUMENTS/tech-stack.md`. Extract:

- every requirement ID (`AUTH-07`, ...) and every `[PRD]` acceptance test,
- the Permissions table (who x account state),
- every API endpoint, error code, audited action, index and transaction the spec names.

## 3. Run the automated checks

Read each package's `package.json` scripts. Run what exists, from inside the package, and save the full raw output to the results folder (`client-lint.log`, `server-test.log`, ...):

1. `lint`, `format:check`
2. `test` once, non-watch. Use coverage if a `test:coverage` script exists or `--coverage` works with the installed Vitest config (do not install packages). Save the JSON/text coverage summary.
3. `build` (client)
4. `npm audit --omit=dev` in both packages (dependency security)

Server tests must use mongodb-memory-server as a replica set. If a test connects to a real database, flag it. Run Playwright (`test:e2e`) only if it exists **and** the app can start without extra setup; otherwise mark it "not run" with the reason. Don't run `npm install` unless `node_modules` is missing, and say so if you do.

## 4. Requirement traceability

For every requirement and acceptance test from step 2, search the test files for its ID in a test name. Mark each one:

- **Covered and passing**, **Covered but failing**, **Covered but weak** (test exists but doesn't really assert the rule - read it), **Not tested**, or **Not implemented** (no code for it).

Spot-check the code, not just the tests: confirm the behaviour exists where the spec says (route, `can()` call, index, audit entry).

## 5. Security and rule audit

Check the code against `.claude/CLAUDE.md` "Rules that must never be broken". For each item give PASS / FAIL / N/A with `file:line` evidence:

- Every protected route goes through `can(user, action, resource)`, checking account state, role and scope. No route trusts a client-sent section or department list.
- Zod validates every body, query and param. CSRF is on every state-changing request. Session cookies are HTTP-only. Rate limits exist on auth routes.
- Email and phone are stored as `email_enc` / `phone_enc`, looked up by `email_hmac`, never returned in rosters, profiles, chat or admin lists. Passwords use argon2id. Admins get the second step on every sign-in.
- No secrets, passwords, tokens, emails or phone numbers in logs (grep pino calls and error handlers). No keys committed (grep for hard-coded secrets and `.env` files in git).
- Time: no hard-coded `+6`, no `new Date()` used for institution-day logic without date-fns-tz, week runs Sunday to Saturday.
- Data integrity: partial unique indexes declared in the schemas; `room_slot_lock` unique index; "first action wins" uses a conditional `findOneAndUpdate`; transactions where the spec says; `audit_log` has no update or delete code path.
- Modules never read another module's collections directly.
- No TypeScript files, no libraries outside `tech-stack.md` (compare both `package.json` files).
- Uploads are unavailable until scanned (when file specs are in scope).
- Hostile-input review: injection (Mongo operator injection in filters, e.g. `{"$ne": ...}`), mass assignment, IDOR, XSS in rendered user text, open redirects, user enumeration on sign-in and recovery.

Then confirm by test, not only by reading: for each role, a test must try another section's or department's data and be refused; concurrency rules must have a test that fires simultaneous requests. List any role or rule without one as a gap.

## 6. Write the report

Save `test-results/<folder>/REPORT.md` with:

1. **Verdict** - one of `PASS`, `PASS WITH GAPS`, `FAIL`, and a one-paragraph reason.
2. **Summary table** - per spec: requirements total / covered / passing / failing / not tested; lint, tests, build, audit status; coverage %.
3. **Failures** - for each: test or check name, file:line, the relevant error lines, one-line likely cause.
4. **Requirement matrix** - ID, short text, status from step 4, test name and file.
5. **Security audit** - the step 5 table, FAILs first, each with severity (high / medium / low) and the rule it breaks.
6. **Gaps** - missing tests (cross-scope, concurrency, account-state), weak tests, skipped checks and why.
7. **Commands run** - exact commands, exit codes, and where the raw logs are.

Also write `test-results/<folder>/summary.json` (verdict, counts, per-spec status) and update `test-results/LATEST.md` with the verdict and a link to the newest report. Don't overwrite older runs.

## 7. Tell me

Reply short: verdict, counts, the top failures and security FAILs, and the path to `REPORT.md`. Then offer next steps (fix failures, add the missing tests) and wait. Report test output as it is; never claim a check passed that you did not run.
