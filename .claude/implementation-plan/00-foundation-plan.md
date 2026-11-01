# Plan: 00-foundation

## Goal
Scaffold the repo from nothing (only DOCUMENTS/, specs/, .claude/ exist) into a running skeleton: npm workspaces `client/ server/ shared/`, Express app with config, errors, validation, time, crypto, `can()` policy engine, append-only audit module, Agenda jobs, mail queue, Socket.IO, security middleware, pino; a Vite/React shell with i18n/PWA; test harness; seed script; CI. Only endpoints: `/api/health`, `/api/auth/csrf`. Also (user request) a `write-tests` project skill.

## Rules / acceptance checklist (test names use FND-xx IDs)
1. FND-01 three ESM workspaces, no TypeScript. 2. FND-02 root lint/test/build scripts (+ per workspace). 3. FND-03 GitHub Actions lint/test/build.
4. FND-04 Zod-checked env, exit naming missing var. 5. FND-05 `.env.example` documented, `.env` ignored.
6. FND-06 refuse start without replica set/transactions. 7. FND-07 `withTransaction` (snapshot, majority, retry). 8. FND-08 `syncIndexes` in dev/test.
9. FND-09 `AppError` + error middleware; unknown -> 500 INTERNAL no details, logged. 10. FND-10 `validate()` -> 400 VALIDATION_ERROR with fields. 11. FND-11 `shared/errors.js` constants.
12. FND-12 injectable clock + time helpers (Asia/Dhaka via date-fns-tz; 17:34Z -> 2026-11-10 / 1414; 18:05Z -> 2026-11-11; weekStart('2026-11-09') = '2026-11-08'). 13. FND-13 no `new Date()`/`Date.now()` outside `lib/time.js` and tests (ESLint `no-restricted-syntax`).
14. FND-14 crypto: encrypt/decrypt (AES-256-GCM `iv.tag.data`), emailHmac, randomToken, hashToken; two encryptions differ.
15. FND-15 `can`/`assertCan` (403 FORBIDDEN or 404 when policy hides existence). 16. FND-16 request user shape. 17. FND-17 `hasRole`, `isAdminOf`, `stateIn`. 18. FND-18 unregistered action throws in dev/test, denies in prod.
19. FND-19 `audit.record/list` (session-aware). 20. FND-20 audit_log append-only (update/delete throw).
21. FND-21 Agenda in-process, per-module `*.jobs.js`, backoff up to 5 tries, failed stays marked + error log. 22. FND-22 idempotent jobs.
23. FND-23 `mail.enqueue` -> `email.send` job; templates text+HTML from server i18n. 24. FND-24 dev/test transport logs + in-memory outbox.
25. FND-25 Socket.IO shares session, rejects unauthenticated, joins `user:<id>`. 26. FND-26 `emitAfterCommit` (never fires on abort; ids/event names only).
27. FND-27 helmet (HSTS in prod), 1 MB JSON limit, trust proxy, CORS off. 28. FND-28 CSRF token in session, `GET /api/auth/csrf`, `X-CSRF-Token` on non-GET else 403 CSRF_FAILED. 29. FND-29 300/min/IP rate limit, Mongo store.
30. FND-30 pino, request ids, redaction, no bodies logged.
31. FND-31 client shell (Tailwind, shadcn init, Router, TanStack Query, api.js, query-keys, socket, time offset, AppShell mobile-first). 32. FND-32 `t()` i18n client + server en.json. 33. FND-33 PWA, API never cached.
34. FND-34 server test harness (MongoMemoryReplSet, factories, loginAs, fixed clock). 35. FND-35 client Vitest+Testing Library; one Playwright smoke test.
36. FND-36 `seed:super-admin` (refuses twice, prints reset link, adds baiust.ac.bd domain). 37. FND-37 `/api/health` ok / 503.
Spec acceptance tests (12 listed) map to: missing DATA_ENC_KEY(4), no replica set(6), 500 INTERNAL(9), CSRF(28), audit update/delete(20), unregistered can(18), crypto(14), time(12), weekStart(12), job retry(21), seed twice(36), abort-no-emit(26).

## Blockers / open questions
- Rate-limit store: **resolved** with user: in-house Mongo store (no new library).
- PRD open questions 1-5 do not block foundation.
- Library notes (all named in tech-stack.md or required by spec): date-fns + date-fns-tz, ESLint, Prettier, helmet, pino + pino-http, mongodb-memory-server, supertest, @testing-library/react, jsdom. `helmet`, `pino-http`, `ioredis`-free. **`pino-http`, `helmet`, `date-fns`, `socket.io`, ESLint plugins are implied by the spec but not literally listed; I will use them and flag in the report.**
- `shared/` workspace is a spec Decision (tech-stack says shared schemas), proceeding.
- Playwright needs browser download; smoke test run only on request.

## Files
Root: `package.json` (workspaces), `eslint.config.js`, `.prettierrc`, `.editorconfig`, `.gitignore`, `.env.example`, `.github/workflows/ci.yml`, update `.claude/CLAUDE.md` Commands section.
`shared/`: `package.json`, `errors.js`, `enums.js` (states, roles, kinds, event names), `schemas/index.js`.
`server/`: `package.json`, `vitest.config.js`, `scripts/seed-super-admin.js`, `src/server.js`, `src/app.js`, `src/config.js`, `src/i18n/en.json`,
 `src/lib/{db,errors,validate,time,crypto,logger,csrf,rateLimitStore,events,socket,jobs}.js`, `src/policy/{can,helpers}.js`,
 `src/modules/audit/{index,audit.model,audit.service}.js`, `src/modules/notifications/{index,mail.service,mail.jobs,transport}.js` + `templates/`,
 `src/modules/auth/auth.routes.js` (only `GET /csrf`), `src/modules/health` route in `app.js`,
 minimal `User`, `UserRole`, `AllowedDomain` models (needed by seed/`makeUser`/`loadUser`) in `modules/auth` and `modules/organisation`,
 `test/{setup,harness,factories}.js` and `__tests__` beside each lib/module.
`client/`: `package.json`, `vite.config.js` (+PWA), `tailwind`, `components.json`, `index.html`, `src/{main,App}.jsx`, `src/components/AppShell.jsx`, `src/lib/{api,query-keys,socket,time,i18n}.js`, `src/i18n/en.json`, `src/index.css`, `src/test/setup.js`, `e2e/smoke.spec.js`, `playwright.config.js`.
Skill: `.claude/skills/write-tests/SKILL.md` (see below).

## Data model
- `audit_log` per spec (actor_id, actor_roles, action, scope_department_id, target_type, target_id, old_value, new_value, at, request_id) with indexes `{at:-1}`, `{scope_department_id:1,at:-1}`, `{target_type:1,target_id:1,at:-1}`; pre-hooks forbid update/delete ops and non-new save (mongo-patterns §7).
- Minimal `user` (kind, state, `email_enc`, `email_hmac` unique, `phone_enc`, `password_hash`, select:false on enc fields), `user_role`, `allowed_domain` (unique domain) - only what seed + factories need; spec 01/03 extend.
- `rate_limits` (key, count, reset_at, TTL index). `agendaJobs` and `sessions` managed by libs. No transactions or first-wins updates in this spec beyond `withTransaction` itself and seed (single transaction for user+role+domain).

## API
- `GET /api/health` -> `{data:{ok:true,db:'up'}}` or 503. No auth.
- `GET /api/auth/csrf` -> `{data:{token}}`. No can() check (public); creates session token.
- All other behaviour is middleware. Audit: seed writes `super_admin.create` entry. `can()` registry has no product actions yet; test policies registered in tests only.

## UI
AppShell with mobile-first nav (bottom bar/hamburger, ≥44px targets), placeholder home route and NotFound; every string via `t()` (keys: `app.name`, `nav.home`, `errors.<CODE>` for all 11 codes, `state.*` placeholders). No account-state screens yet (spec 01).

## Tests (Vitest; names `it('FND-xx ...')`)
Config (4,5), db replica check + withTransaction retry (6,7,8), errors/validate (9,10,11), time with fixed clock incl. 17:34Z/18:05Z/weekStart + ESLint Date rule test (12,13), crypto (14), can/helpers incl. 404-hiding and unregistered (15-18), audit append-only + session-aware record (19,20), jobs retry/fail/idempotent (21,22), mail enqueue + outbox (23,24), socket auth + emitAfterCommit abort (25,26), headers/CSRF/body limit/rate limit (27-29), logger redaction (30), health (37), seed twice-refusal (36), harness `loginAs` self-test (34). Cross-scope refusal tests: `can()` matrix test for each role vs other department/section using test-registered policies; concurrency: rate-limit store increments under `Promise.all`. Client: api.js (CSRF header, ApiError), time offset, `t()`, AppShell render (31,32); Playwright smoke (35). Build/PWA check via `npm run build` (33).

## Build order (tests with each step)
1. Root tooling, workspaces, shared/. 2. Config + logger + errors + validate + app skeleton + health. 3. db/withTransaction/replica check. 4. time + Date lint rule. 5. crypto. 6. Test harness + factories + loginAs. 7. Policy engine. 8. Audit module. 9. Security middleware (helmet, CSRF, rate store). 10. Jobs + mail. 11. Socket.IO + emitAfterCommit. 12. Seed script. 13. Client shell, i18n, PWA, tests, Playwright smoke. 14. CI workflow. 15. `write-tests` skill. 16. Fill CLAUDE.md Commands. 17. Run checks; walk checklist.

## write-tests skill (requested)
`.claude/skills/write-tests/SKILL.md`: given a spec/PRD section, extract each requirement ID/acceptance criterion, write Vitest/Supertest/Playwright tests named `it('XXX-nn ...')`, use harness factories + `loginAs`, always add cross-department/section refusal tests per role, per-state refusal tests, concurrency tests with `Promise.all`, audit-entry assertions, fixed clock; finish with a requirement->test coverage table. Complements `run-checks` (which only runs).

## Out of scope
Any feature endpoint/screen beyond health and csrf; sign-in/sessions options (spec 01); email catalogue/batching/bounces (15); Docker/Caddy/DB roles/backups (23); real ClamAV/GridFS; Bangla; deployment. No commit.

## Verification
`npm install`; `npm run lint`, `npm test`, `npm run build` from root; run server with local replica set to hit `/api/health`; seed script twice; Playwright smoke only on request.
