# Plan: 07 Routine import

Spec: `.claude/specs/07-routine-import.md` (the `specs/` folder named in the command lives under `.claude/`). Depends on 04 semesters, 05 classrooms, 06 teachers (all built).

## Goal

A department admin downloads the template, uploads the filled `.xlsx` for a draft or current semester, sees every error and warning, a preview per section and (on a re-import) a diff of the department's own slots, then publishes. Publishing creates the sections and groups, upserts teachers, and saves the department's slots in one transaction. A department only ever replaces its own slots.

## Rules and acceptance criteria

IMP-01 … IMP-33 from the spec, one checklist item each (numbers match the test names `it('IMP-xx …')`). Extra acceptance tests: concurrent second publish → `ALREADY_DECIDED`; EEE admin on a CSE import → 404; student/teacher/CR → 403; infected file → `FILE_INFECTED` and no import; one email per affected student.

## Blockers / open questions

- PRD open question 3 ("No class allowed" periods): not built, as the spec says.
- IMP-19 (approved booking clash) waits for spec 19: not built.
- IMP-28 emails to students need enrolments (spec 10): the audience is a registered provider (`registerAudienceProvider`); teachers are covered now.
- IMP-28 routine cache clear (spec 12): a registered listener hook (`registerRoutineChangeListener`), nothing registered yet.

None of these blocks the work.

## Departures from the spec (and why)

1. **Upload is a raw request body, not multipart.** No multipart library is in `tech-stack.md`, and the profile photo already uses a raw body. `department_id` is a query parameter: `POST /api/semesters/:id/imports?department_id=`.
2. `diff` is computed on demand (preview and publish) instead of stored on `routine_import`, so it is never stale when slots are edited by hand between upload and publish.
3. `exceljs` (already in `tech-stack.md`) is added to `server/package.json`.
4. New error codes `FILE_INFECTED` (422) and `IMPORT_HAS_ERRORS` (409).

## Files

Server, new module `server/src/modules/routine/`:
`routine.model.js`, `parse.js` (pure), `validate.js` (pure), `diff.js` (pure), `template.service.js`, `xlsx.js` (read the workbook), `import.service.js`, `publish.service.js`, `routine.policy.js`, `routine.controller.js`, `routine.routes.js`, `index.js`, `__tests__/`.
Changed: `app.js` (mount), `server.js` (nothing needed), `lib/gridfs.js` (imports bucket), `organisation` (`getSemester`, `openSemesterIds`), `teachers` (`directoryFor`, `teachersByIds`, `linkedUserIds`, `upsertFromImport`), `rooms` (nothing), `notifications` templates + `i18n/en.json` (`routine_changed`), `test/harness.js` (register models), `shared/` (`schemas/imports.js`, error codes).
Client: `features/imports/{api,hooks}.js`, `routes/admin/RoutineImportPage.jsx`, route + nav link, `i18n/en.json`, `lib/query-keys.js`, a test.

## Data model

`section`, `section_group`, `routine_import`, `routine_slot`, `routine_slot_teacher` as in the spec, with these indexes: unique `{semester_id, department_id, level, term, letter}`; unique `{section_id, label}`; partial unique `{semester_id, department_id}` where `status: 'checked'`; slot indexes `{semester_id, section_id, published}`, `{semester_id, room_id, day_of_week}`, `{semester_id, owner_department_id}`; unique `{slot_id, teacher_id}`. Upload replaces the open import and inserts the new one in one transaction. Publish flips `checked → published` with a conditional `findOneAndUpdate` first (first action wins), then does everything else in the same transaction.

## API

As in the spec. `can()` actions: `import.access` (active admin; students/teachers/CRs get 403) and `import.manage` (`{department_id}`: admin of that department or super admin). An admin of another department gets 404 on by-id and list routes (existence is hidden). Audit: `routine.publish` (counts) and `routine.import_upload`. Events after commit: `routine.changed` to `section:<id>` and `user:<id>`.

## UI

Routine import page at `/admin/routine-import`: department and semester pickers, template download, upload, issue list with error/warning filter and combined-class confirm, preview per section (day list), diff with keep/replace, publish dialog with the "I have reviewed N warnings" checkbox. All text in `client/src/i18n/en.json`.

## Tests

Server API tests per requirement (named `IMP-xx`), pure unit tests for parse/validate/diff, cross-scope refusals, a concurrent publish test. Client test for the page.

## Build order

1 shared + models + parse/validate/diff with unit tests → 2 template → 3 upload/list/preview → 4 confirm + keep choices → 5 publish + events/email/audit → 6 client → 7 run-checks.

## Out of scope

Single-slot editing (spec 08), reading the old Excel layout, booking clashes (spec 19), "no class allowed" periods, enrolment-based student audience (spec 10), the routine cache itself (spec 12).

## Client details (built)

- `client/src/features/imports/{api,hooks}.js`, `components/{UploadCard,IssueList,SectionPreview,DiffView,PublishDialog,time}.js(x)`, `client/src/routes/admin/RoutineImportPage.jsx`, route `/admin/routine-import` inside `RequireAdmin`, nav link, `imports.*` strings in `client/src/i18n/en.json`, query keys `importsAll/imports/importPreview`.
- The semester picker reuses `GET /api/admin/semesters` (allowed for department admins) and lists draft and current semesters only.
- Publish uses an inline `role="dialog"` panel (focus moves to its heading, Escape closes it), not a dialog library.
- Issue messages are shown as the server sends them (they carry the row and values); labels, buttons and statuses are translated.
- Day names are `imports.day.0..6` because `t()` only returns strings.
- Server test `FND-11` updated for the two new error codes `FILE_INFECTED` and `IMPORT_HAS_ERRORS`.
- Client tests: `client/src/routes/__tests__/routine-import.test.jsx` (10 tests: IMP-01, 02/03, 08..11, 12..15, 21, 24, 25, 32, 33, non-admin).
