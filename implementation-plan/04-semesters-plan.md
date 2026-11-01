# Plan: Spec 04 – Semesters

(Spec file: `.claude/specs/04-semesters.md`. The `specs/` folder in the command does not exist; this is the only match. After approval this plan is saved to `implementation-plan/04-semesters-plan.md`.)

## Goal
Semesters exist as named periods with dates and a state (`draft` → `current` → `archived`). A super admin creates and edits them, deletes an unused draft, and may bootstrap the very first semester straight to `current`. Other modules read the semester only through exported `currentSemester()` / `draftSemester()`. The current semester's name shows in the app header. Rollover/readiness is spec 14 and is NOT built.

## Rules and acceptance criteria
1. SEM-01 Super admin creates a semester: unique name, start, end (end after start), starts `draft`.
2. SEM-02 States only `draft→current→archived`; at most one `current` and at most one `draft` (two partial unique indexes). Second draft → `CONFLICT`. Two concurrent bootstrap calls → exactly one current.
3. SEM-03 Super admin edits name/dates of a draft or current semester; archived → `SEMESTER_ARCHIVED`; end ≤ start → `VALIDATION_ERROR` (checked on the merged values). Date change on the current semester is audited and emits `calendar.changed` to everyone (after commit).
4. SEM-04 Delete only a draft with nothing attached (sections/events/roles); otherwise `SEMESTER_IN_USE`.
5. SEM-05 `currentSemester()` and `draftSemester()` exported from the module index.
6. SEM-06 Students/teachers never see a draft or anything attached. `GET /semesters/current` never returns a draft. A non-admin using a draft id on any endpoint gets `NOT_FOUND`.
7. SEM-07 Bootstrap: allowed only if no semester has ever been current; `CONFLICT` otherwise. Creates no unconfirmed students (nobody is active yet; nothing to do).
8. Permissions table: create/edit/delete/bootstrap = active super admin only; list = any active admin (dept admin read-only); read current = any signed-in user.
9. Audit every create, edit, delete, bootstrap (PRD Auditability). Dates stored as `YYYY-MM-DD` institution dates; `made_current_at` UTC via `clock.now()`.

## Blockers / open questions
- None from the PRD's Open questions (all unrelated).
- Decision to confirm: put the code in the **organisation** module (`semester.*` files, beside departments) rather than a new module; CLAUDE.md's module list has no "semester" module. Spec 11 `calendar` will call `currentSemester()`.
- Decision to confirm: the SEM-06 "NOT_FOUND" is done with the existing `hideExistence` policy option, so a non-admin touching a semester id gets 404 on all `:id` routes (draft or not, which leaks nothing).
- Note: "attached" (SEM-04) has no owners yet (sections/events/roles arrive in specs 08, 09, 11). I follow spec 03's pattern: `registerSemesterUsage({ inUse })` provider registry; with no providers a draft is deletable. The SEM-04 test registers a fake provider (the real section test lands with spec 07/08).
- Needs a socket room for "everyone": add `socket.join('everyone')` in `server/src/lib/socket.js` (small, in scope for `calendar.changed` to everyone).

## Files
**shared/**
- `schemas/semesters.js` (new): `createSemesterBody`, `updateSemesterBody`, `semesterIdParam`; reuse `dateString`, `objectIdString`; end>start refine.
- `schemas/index.js` export it; `errors.js` add `SEMESTER_ARCHIVED` (409), `SEMESTER_IN_USE` (409).
- `__tests__/` schema test.

**server/src/modules/organisation/**
- `organisation.model.js`: add `Semester`.
- `semester.service.js`, `semester.controller.js`, `semester.routes.js` (new).
- `organisation.policy.js`: add `semester.manage`, `semester.list`, `semester.read` (hideExistence for by-id use).
- `index.js`: export `currentSemester`, `draftSemester`, `registerSemesterUsage`, `resetSemesterUsage`, routers, `Semester`.
- `__tests__/semesters.api.test.js` (new).
- `server/src/app.js`: mount `semestersRouter` at `/api/semesters` (requireAuth) and admin router under `/api/admin` (requireAuth).
- `server/src/lib/socket.js`: join `everyone`.

**client/src/**
- `features/admin/api.js`, `hooks.js`: semester calls/hooks; `features/semesters/` not needed.
- `lib/query-keys.js`: `currentSemester`, `adminSemesters`.
- `routes/admin/SemestersPage.jsx` (new); `App.jsx` route `/admin/semesters` (inside RequireSuperAdmin, like departments).
- `components/AppShell.jsx`: nav item (super admin) + current-semester name in the header/side rail; `components/CurrentSemester.jsx` (new) with a `calendar.changed` refetch via `lib/socket.js`.
- `i18n/en.json`: `admin.semesters.*`, `nav.adminSemesters`, `semester.current`/`semester.none`.
- `routes/__tests__/admin.test.jsx` (add cases).

## Data model
`semester` (collection `semester`): `name` (trim, unique index with collation `{locale:'en',strength:2}`), `status` enum default `draft`, `start_date`, `end_date` (`YYYY-MM-DD` strings), `made_current_at?`, `made_current_by?`, `archived_at?`, timestamps.
Indexes: unique `{name}`; partial unique `{status:1}` where `status:'current'`; partial unique `{status:1}` where `status:'draft'` (two separate named indexes, `partialFilterExpression`).
Bootstrap (first action wins) in ONE transaction: check nothing has `made_current_at`/status `archived|current`, then `findOneAndUpdate({_id, status:'draft'}, {$set:{status:'current', made_current_at, made_current_by}})`; null → `CONFLICT`. The partial unique index on `current` is the backstop for concurrent calls. Edit uses `findOneAndUpdate({_id, status:{$ne:'archived'}})`.

## API (all JSON `{data}`; Zod via `validate()`; CSRF already global)
| Endpoint | can() | Notes / audit |
|---|---|---|
| `GET /api/semesters/current` | signed in (requireAuth) | `{name,start_date,end_date}` or `null`; only status `current` |
| `GET /api/admin/semesters` | `semester.list` (active super/dept admin) | newest first; includes draft |
| `POST /api/admin/semesters` | `semester.manage` | 201; dup name or existing draft → `CONFLICT` (E11000 mapped); audit `semester.create` |
| `PATCH /api/admin/semesters/:id` | `semester.manage` | archived → `SEMESTER_ARCHIVED`; audit `semester.update` (old/new); if current and dates changed: `emitAfterCommit('everyone','calendar.changed')` |
| `DELETE /api/admin/semesters/:id` | `semester.manage` | 204; non-draft or provider says in use → `SEMESTER_IN_USE`; audit `semester.delete` |
| `POST /api/admin/semesters/:id/bootstrap-current` | `semester.manage` | audit `semester.bootstrap_current` |
Non-admins on `:id` routes get 404 (`hideExistence`); unknown id → `NOT_FOUND`.

## UI
`/admin/semesters` (super admin; dept admin list is server-allowed but no UI link needed in this spec): list (name, dates, status badge), create form (name, start, end; RHF-style like DepartmentsPage with server field errors), edit (draft/current), delete (draft, confirm), "Make current (first semester)" button shown only when nothing was ever current. Header shows current semester name or "No current semester". All text in `en.json`; labels, aria, 360 px layout.

## Tests (named `SEM-0x …`)
- Server: SEM-01 create ok + audit + unique name (#1); SEM-02 second draft CONFLICT, 4 parallel creates → one draft, 4 parallel bootstraps → one current, current-index backstop (#2); SEM-03 end<start 400, archived 409, dates edit audited + emitter spy gets `calendar.changed` once, name-only edit on current doesn't emit (#3); SEM-04 deletable empty draft, fake provider → `SEMESTER_IN_USE`, current/archived not deletable (#4); SEM-05 `currentSemester()/draftSemester()` (#5); SEM-06 student/teacher/unconfirmed get `null` for draft-only, 404 on draft id for PATCH/DELETE/bootstrap (#6); SEM-07 bootstrap refused when one was ever current, incl. after archive (#7); cross-scope: dept admin can list but POST/PATCH/DELETE/bootstrap → 403, student/teacher/unauthenticated refused, non-active admin refused (#8); audit entries present (#9).
- Shared schema tests. Client: list/create error display, header shows name, non-super doesn't see page/link, delete confirm.

## Build order
1. Shared schemas + error codes (+tests). 2. Model + indexes + service + policy (+ service/API tests incl. concurrency). 3. Routes/controller, mount in app, socket room. 4. Client api/hooks/keys. 5. SemestersPage + header + nav + i18n (+ client tests). 6. `run-checks` (lint, tests, build); tick the spec's task list status only if asked (spec file left alone).

## Out of scope
Readiness checklist, normal "make current"/archive rollover (spec 14), sections/events/roles (the "in use" providers), unconfirmed-student handling, dept-admin semester UI, calendar module.
