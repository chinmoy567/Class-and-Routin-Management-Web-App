---
description: Plan a spec from specs/ in plan mode, save the plan to implementation-plan/<spec>-plan.md, then implement it
argument-hint: <spec file, e.g. 01-auth-accounts or specs/01-auth-accounts.md>
---

I want to build this spec: **$ARGUMENTS**

First plan it in plan mode. Write no code until I approve the plan. After I approve, save the plan and then implement it.

1. **Enter plan mode** (call EnterPlanMode if you are not already in it).

2. **Find the spec.** Resolve `$ARGUMENTS` to one file in `specs/` (accept a number like `07`, a name like `07-routine-import`, or a full path). If it doesn't match exactly one file, stop and ask me.

3. **Read everything it depends on, properly — not skimming:**
   - The whole spec file, plus `specs/README.md`.
   - Any earlier specs it depends on or refers to.
   - The matching sections of `DOCUMENTS/Class and Routine Management - PRD.md`, including every acceptance criterion and the "What each state can use" table where relevant.
   - `DOCUMENTS/tech-stack.md` (it wins over the PRD on conflicts).
   - The relevant diagrams in `DOCUMENTS/src/` (state, sequence, ER) — always for onboarding, booking, import or rollover.
   - The PRD's "Open questions" section.
   - The current code in `client/` and `server/` that this spec touches, so the plan builds on what exists.
   - The project skills that apply (`build-feature`, `api-module`, `mongo-patterns`, `ui-conventions`).

4. **Write the plan.** It must contain:
   - **Goal** — one short paragraph on what this spec delivers.
   - **Rules and acceptance criteria** — a numbered checklist of every rule and acceptance criterion from the spec and PRD.
   - **Blockers / open questions** — anything an open question blocks, or anything unclear. Ask me about these instead of guessing.
   - **Files** — every file to create or change, grouped by module (`server/src/modules/<module>/…`, `client/…`).
   - **Data model** — Mongoose models, fields and indexes (including partial unique indexes), transactions, and "first action wins" updates.
   - **API** — each endpoint with method, path, Zod schema, the `can()` check (state, role, scope), and audit entries.
   - **UI** — pages, components, forms, translation keys, account-state screens.
   - **Tests** — a test for every acceptance criterion, cross-scope refusal tests for every role, and concurrency tests where needed. Map each test back to its checklist number.
   - **Build order** — small steps, tests written together with the code.
   - **Out of scope** — what this plan deliberately does not do.

   Follow every rule in `.claude/CLAUDE.md`. Don't add libraries that aren't in `tech-stack.md`.

5. **Show me the plan with ExitPlanMode** and wait for my approval. If I ask for changes, revise and show it again.

6. **After I approve, save it** to `implementation-plan/<spec-file-name>-plan.md` (for example `specs/07-routine-import.md` → `implementation-plan/07-routine-import-plan.md`). This is the **repo-root** `implementation-plan/` folder, the only place plans live. Never save plans under `.claude/`, and never create a second plan folder. Create the folder if it doesn't exist. If the file already exists, tell me and ask before overwriting.

7. **Implement the plan** right after saving it. Don't wait for another prompt.
   - Follow the plan's build order, step by step, and use the `build-feature` skill workflow.
   - Write each step's tests together with its code, not afterwards.
   - Follow every rule in `.claude/CLAUDE.md` and the project skills (`api-module`, `mongo-patterns`, `ui-conventions`).
   - Build only what the plan covers. If something comes up that the plan doesn't cover, or an open question blocks a step, stop and ask me instead of guessing.
   - If you have to depart from the plan, say why and update the saved plan file to match.

8. **Check the result.**
   - Run the `run-checks` skill (lint, tests, build) and fix any failures.
   - Go through the plan's rules and acceptance criteria checklist and confirm each item is implemented and has a passing test.

9. **Report back** with:
   - the saved plan path
   - the files you created or changed
   - the checklist, with each item marked done or not done
   - the test results, including any failures, shown as they are
   - anything skipped or still open

   Don't commit unless I ask.
