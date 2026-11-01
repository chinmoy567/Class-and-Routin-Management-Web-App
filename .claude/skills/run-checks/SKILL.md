---
name: run-checks
description: Run lint, tests and build for the client and server and report what failed. Use after finishing a change, before saying work is done, before a commit, or when the user types /run-checks or asks to "check everything".
argument-hint: "[client|server]  (optional: limit to one side)"
---

# Run the project checks

Scope: **$ARGUMENTS** (empty means both `client` and `server`).

The project has two packages, `client/` and `server/`. Don't hard-code commands. Read each package's `package.json` `scripts` and run whichever of these exist, in this order:

1. `lint` (ESLint)
2. `format:check` (Prettier), if present
3. `test` (Vitest, plus Supertest for the server). Run it once in non-watch mode: `npm run test -- --run` if the script is plain `vitest`.
4. `build` (client only, Vite)

Run them from inside each package folder (`npm --prefix client run lint`, and so on). If a package folder or a script doesn't exist yet, say so and skip it. Don't create scripts or config to make a check pass.

Playwright end-to-end tests (`test:e2e`) are slow and need the app running. Run them only if the user asks.

## Before running

- Server tests need nothing running: they start their own `MongoMemoryReplSet`. If they try to connect to a real MongoDB, report that as a problem.
- Don't run `npm install` unless `node_modules` is missing, and say so if you do.

## Report

Keep it short:

```
client  lint ✅  test ✅ (42 passed)  build ✅
server  lint ❌ 3 errors  test ❌ 2 failed / 118 passed
```

Then, for each failure: the file and line, the error or the failing test name, and a one-line likely cause. Show only the relevant lines of output, not the whole log.

**Don't fix anything unless the user asks.** If they do, fix the cause, not the check: never weaken a test, add `eslint-disable`, skip a test, or loosen a rule just to get a green result.
