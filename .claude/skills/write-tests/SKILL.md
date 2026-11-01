---
name: write-tests
description: Write the automated tests for a spec or PRD section - one test per requirement ID and acceptance criterion, plus cross-scope refusal, account-state, concurrency and audit tests - using the project's test harness (Vitest, Supertest, MongoMemoryReplSet, Playwright). Use when asked to "write tests", to add tests for a feature, or to close coverage gaps found by /run-checks or /verify-spec.
argument-hint: "<spec file or requirement IDs, e.g. specs/01-auth-accounts.md or AUTH-07>"
---

# Write tests for: $ARGUMENTS

Tests are how every requirement is proven. Write them **with** the code, not after. Do not weaken or skip a test to make it pass; if a test is wrong, say why before changing it.

## 1. List what must be tested

1. Read the spec (`specs/NN-name.md`) and the PRD sections it names. Copy every requirement ID (`AUTH-07`) and every Given/When/Then acceptance test into a checklist.
2. Add the implied tests the rules in `.claude/CLAUDE.md` demand:
   - **Cross-scope refusal:** for every role, a request that reaches another department's, section's or semester's data must be refused (`403`, or `404` when existence must stay hidden).
   - **Account state:** each state the PRD's "What each state can use" table says is blocked must be refused with the right code.
   - **Concurrency:** "first action wins", the 3-request limit and double-booking get tests that fire requests together with `Promise.all`.
   - **Audit:** every action in the PRD's Auditability list writes an `audit_log` entry.
   - **Privacy:** responses never contain `email_enc`, `email_hmac`, `phone_enc`, `password_hash`, or another user's email or phone.
   - **Time:** any rule that depends on "now" fixes the clock first.

## 2. Where tests live and how they are named

- Server: `server/src/modules/<module>/__tests__/<module>.api.test.js` (Supertest) and `<module>.service.test.js` (logic). Shared libs: `server/src/__tests__/`.
- Client: `*.test.jsx` beside the code in `__tests__/` (Vitest + Testing Library). Journeys: `client/e2e/*.spec.js` (Playwright, phone-sized viewport, run only when asked).
- **Name every test after its requirement:** `it('AUTH-07 a wrong password five times locks the account', …)`. For a PRD criterion without an ID use the spec prefix and a short description. One behaviour per test.

## 3. Use the harness (server)

From `server/test/harness.js` and `server/test/factories.js`:

- `await connectTestDb()` / `disconnectTestDb()` (own database per test file, on the shared replica set, indexes built). Call `clearDb()` between tests that need a clean slate. Use top-level `await connectTestDb()` if you build the app at describe time.
- `makeUser({ kind, state, roles: [{ role, department_id, section_id, semester_id }] })` gives a user; add the factories for new collections to `factories.js` in the same change as the model.
- `buildTestApp({ mountApi })` then `await loginAs(user, app)` returns a Supertest agent with the session and CSRF header already set. `loginAs(null, app)` is a signed-out agent that still has a CSRF token.
- `fixClock('2026-11-10T17:34:00Z')` and `resetClock()` (call it in `afterEach`) fix "now".
- Email: read `getOutbox()` from the notifications module. Jobs: start with `startJobs(...)` and a fast `processEvery`.
- Never connect to a real MongoDB; never use `new Date()`/`Date.now()` for rules (tests may, the lint rule only covers `src`).

## 4. Shape of a good test

- Arrange with factories, act through the HTTP API (not the service) for anything a user can do, assert on the **status, the error `code`**, the response body, and the database or audit state.
- Refusal tests assert both the refusal **and that nothing changed**.
- Concurrency: fire the requests with `Promise.all`, then assert exactly one success and the rest `409` (`ALREADY_DECIDED`/`REQUEST_LIMIT`/…), and the final counts.
- Prefer several small tests over one long one. No sleeps for ordering; poll with a bounded `waitFor` when a background job is involved.

## 5. Finish

1. Run the new tests, then the whole suite with the `run-checks` skill. Report failures as they are.
2. End with a coverage table so gaps are visible:

```
Requirement   Test file : test name                         Status
AUTH-07       auth.api.test.js : AUTH-07 …                   ✅ passing
AUTH-08       —                                              ❌ missing
```

Any requirement without a passing test is listed as missing. Do not claim a spec is done while one is.
