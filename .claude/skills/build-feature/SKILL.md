---
name: build-feature
description: Step-by-step workflow for building one feature from the PRD - read its section and diagrams, list every rule and acceptance criterion, plan, write tests, write the code, then check the result against the list. Use when the user asks to build or implement a feature, a PRD section, a screen or an endpoint (for example "/build-feature Classroom booking rules").
argument-hint: <PRD section or feature name>
---

# Build a feature from the PRD

Feature to build: **$ARGUMENTS**

The PRD is `DOCUMENTS/Class and Routine Management - PRD.md` and the stack is in `DOCUMENTS/tech-stack.md`. Follow these steps in order and don't skip any.

## Step 1: Read

1. Find the section(s) for this feature in the PRD (`grep -n "^##" ` the PRD for its headings). Read the whole section, plus every section it links to ("see Routine edit page", "see Account states and access"…).
2. Always also check:
   - **Account states and access**: which states may use the feature.
   - **Users & roles**: which roles may use it and in what scope.
   - **Technical approach**: the collections, indexes, concurrency rules and API paths involved.
   - **Acceptance criteria**: the ones for this feature.
   - **Open questions**: if one blocks this feature, **stop and tell the user**. Don't guess an answer.
3. Read the matching diagrams in `DOCUMENTS/src/` (Mermaid source):

| Feature area | Diagrams |
|---|---|
| Sign-up, sign-in, email check, second step | 17-seq-auth-login, 19-state-account |
| Student onboarding, join request, UV ID claim | 09-activity-student-onboarding, 15-seq-join-request, 20-state-join-request |
| Teacher approval | 10-activity-teacher-approval, 19-state-account |
| CR/DCR assignment | 26-activity-cr-dcr-assignment, 02-role-hierarchy |
| Room booking, free-room view | 11-activity-room-booking, 16-seq-room-request, 21-state-room-request, 28-activity-free-room-check |
| Routine import and edit | 12-activity-routine-import, 25-routine-resolution |
| My routine, live status | 14-activity-live-status, 25-routine-resolution |
| Semester rollover | 13-activity-semester-rollover, 22-state-semester-section |
| Chat, files, moderation | 18-seq-chat-message, 27-activity-chat-moderation |
| Data model, any feature | 05-er-diagram, 06-class-diagram |
| Screens and navigation | 24-sitemap |

## Step 2: List the rules

Write a numbered checklist and show it to the user before planning. Cover:

- every rule in the section ("must", "only", "cannot", limits, time windows, who decides),
- who may do it: roles × account states × scope (department, section, semester),
- every error case and the message the user sees,
- data rules: unique or partial indexes, "first action wins", transactions,
- side effects: audit entries, emails, push events, background jobs,
- time rules, all in `Asia/Dhaka`,
- each matching **acceptance criterion**, word for word.

Number them R1, R2… and refer to these numbers in tests and in the final check.

## Step 3: Plan

Say briefly which files you'll create or change: back-end module (following the **api-module** skill), models and indexes (following the **mongo-patterns** skill), endpoints, client pages and components, jobs. If the feature crosses modules, say how they talk (through each module's `index.js`).

If the plan touches more than one module or adds a collection, **wait for the user to agree** before writing code.

## Step 4: Tests first

Write the tests before the code they cover:

- one test per acceptance criterion (name it after the criterion),
- one test per blocking rule, checking the error `code`,
- permission tests: wrong role, wrong state, **another department**, **another section**,
- concurrency tests for anything that is first-action-wins, limited or booked,
- time tests using a fixed fake clock (never the real time), including the `Asia/Dhaka` day and week edges.

Run them and check that they fail for the right reason.

## Step 5: Build

Write the code until the tests pass. Stay inside the checklist: don't add features, settings or screens the PRD doesn't ask for. If a rule is unclear or two PRD sections disagree, stop and ask.

## Step 6: Check

1. Run lint, the tests and the build (use the **run-checks** skill).
2. Go through the checklist from Step 2 and mark each item **done**, with the test that covers it, or **not done**, with the reason.
3. Report to the user:
   - what was built and which files changed,
   - the checklist with its status,
   - anything left open, assumed or blocked.

Don't commit unless the user asks.
