# 07: Routine import

R1 · Status: Draft · Depends on: 04, 05, 06 · PRD: Routine management, Routine file import, Import template and checks, Sessional groups, Technical approach (routine_slot, API Import) · Diagrams: 12-activity-routine-import, 25-routine-resolution

## Goal

A department admin uploads the filled routine template for a semester, sees every error and warning plus a preview (and, on a re-import, a diff), then publishes. Publishing creates the sections and groups, saves the department's slots, and makes the routine visible. A department only ever replaces **its own** slots.

## Scope

**In:** the downloadable template, upload and parsing, the teacher sheet, validation (errors and warnings), preview, re-import diff with keep/replace choices, publish, creating sections and groups, slot ownership, routine-change notification.

**Out:** editing single slots on the web page (spec 08), reading the old human-made Excel layout (out of scope in the PRD).

## Requirements

### Template
- **IMP-01** `GET /api/admin/imports/template` returns an `.xlsx` built with ExcelJS. It has a **Routine** sheet with columns `Department | Level | Term | Section | Group | Day | Start | End | Course code | Course name | Teachers | Room`, drop-downs for Department (active codes), Level (1–4), Term (I, II), Day (Sunday–Thursday) and Room (the department's room codes and aliases), and cells formatted as text so `4-I` isn't turned into a date. It also has a **Teachers** sheet with columns `Department | Short code | Full name`, and an instructions sheet.

### Upload
- **IMP-02** An admin of department D uploads a template for a semester that is `draft` or `current`. Only `.xlsx` up to 5 MB is accepted, checked from the content. `.xlsm` and other types are refused (`FILE_TYPE_NOT_ALLOWED`). The file is scanned by ClamAV before it is parsed, and stored in GridFS.
- **IMP-03** Uploading creates a `routine_import` in status `checked` (or `failed` if the file can't be read at all) holding the parsed rows, every issue and a preview. Nothing visible to students changes. Only one open (`checked`) import per department and semester: a new upload replaces the old open one.

### Parsing and normalisation
- **IMP-04** Each Routine row is read as plain text, trimmed. Department is upper-cased. Level must be 1–4. Term must be `I` or `II` (`1`/`2` are accepted and converted). Section must be one letter A–Z, and is set to `A` when empty and the batch has only one section in the file. Group is `G<number>` or empty (empty = whole section). Day is a full or 3-letter day name, case-insensitive. Start and End are `H:MM` or `HH:MM`, 24-hour.
- **IMP-05** Teachers are written `DEPT:CODE`, joined with `+` for shared classes, or `TBA`. A code without a department is an error.
- **IMP-06** Room is resolved with `rooms.resolve()` (spec 05).
- **IMP-07** Teachers sheet rows are department + short code + full name. On publish they are upserted into the `teacher` directory (spec 06): new records are created, and a changed full name updates the record (shown as a warning first).

### Errors (block publishing)
- **IMP-08** Unknown teacher: a `DEPT:CODE` that is neither in this file's Teachers sheet nor in the saved directory.
- **IMP-09** The same department + short code appears twice in the Teachers sheet with different names.
- **IMP-10** Unknown room: no room code or alias matches (or the room is retired).
- **IMP-11** A missing required field (department, level, term, day, start, end, course code, teachers, room), an unreadable day or time, an end time not after the start time, a day outside Sunday–Thursday, or an unknown or retired department.

### Warnings (shown; publishing allowed after review)
- **IMP-12** Teacher overlap: the same teacher has two rows overlapping in time on the same day.
- **IMP-13** Room overlap: the same room in two rows overlapping in time on the same day.
- **IMP-14** Section overlap: one section or group has two rows overlapping, including a whole-section row overlapping a group's row.
- **IMP-15** A teacher is `TBA`.
- **IMP-16** The same course and group appear twice on one day.
- **IMP-17** A class starts before 08:30 or ends after 17:30.
- **IMP-18** Cross-department duplicate: another department already has a published slot for the same section, day, overlapping time and course code. Both admins see this warning (the other admin on their dashboard, spec 18).
- **IMP-19** Approved booking clash: the room and time have an approved booking on a future date (only once spec 19 exists).
- **IMP-20** A teacher's full name in the Teachers sheet differs from the saved directory.
- **IMP-21** Combined class: when rows of a teacher or room overlap and share the same teacher(s), room, day and time, the warning offers "confirm as combined class". Confirming gives those rows a shared `combined_key`, and the overlap warning is marked confirmed.
- **IMP-22** Overlaps are checked against rows in this file **and** against other departments' published slots of the same semester for the same room or teacher.

### Preview
- **IMP-23** The preview shows, per section (department + level + term + letter), the weekly grid of rows, the sections and groups that will be created, the issue list (errors first, each with its sheet row number) and counts.

### Re-import diff
- **IMP-24** If department D already has published slots in this semester, the preview also shows a diff of D's slots only: **added**, **removed** and **changed** (matched on section, group, day, start time and course code). Slots that the admin created or edited on the routine edit page since the last import are marked "edited by hand", and for each one the admin chooses **keep** or **replace**. The default is keep.

### Publish
- **IMP-25** Publishing is refused while any error remains (`IMPORT_HAS_ERRORS`). The admin must confirm "I have reviewed N warnings". Publishing needs a confirmation step on the client (destructive action).
- **IMP-26** Publishing runs in one transaction. It creates any missing `section` and `section_group` for the semester (for any department in the file), upserts teacher records, deletes D's slots that are removed or replaced, inserts and updates D's slots as `published: true` with `source: 'import'`, keeps slots marked keep, and marks the import `published`. It never touches another department's slots.
- **IMP-27** A section created for **another** department's batch is shown on that department admin's dashboard as "Section created by CSE import" (spec 18).
- **IMP-28** After commit: an audit entry `routine.publish` (counts of added, removed and changed), `routine.changed` events for every affected section and teacher, the routine cache cleared for those sections (spec 12), and, if the semester is current, one batched "your routine changed" email per affected student and teacher (spec 15).
- **IMP-29** An import whose semester stopped being draft or current before publishing is refused (`SEMESTER_ARCHIVED`).

### Ownership and visibility
- **IMP-30** Every slot has `owner_department_id` = the importer's department. A section's routine is the union of all departments' published slots for it.
- **IMP-31** The section's batch department doesn't have to be D: a CSE sheet can contain `LAW 1-II` rows. Those slots belong to CSE.

## Permissions

| Action | Admin of D | Super admin | Others |
|---|---|---|---|
| Download template, upload, view import, publish for D | ✔ | ✔ (as any dept) | ✘ |
| View another department's import | ✘ | ✔ | ✘ |

## Data

- `section`: semester_id, department_id, level, term, letter, created_by_import_of? (department_id), closed_at?. Unique `{ semester_id, department_id, level, term, letter }`.
- `section_group`: section_id, label. Unique `{ section_id, label }`.
- `routine_import`: semester_id, department_id, file_id, status (`checked` | `failed` | `published` | `replaced`), rows[] (normalised row + sheet row number), teachers[], issues[] ({ row, severity, code, message, related_rows[], confirmed? }), diff?, keep_choices{}, uploaded_by, uploaded_at, published_by?, published_at?. Partial unique `{ semester_id, department_id }` where `status: 'checked'`.
- `routine_slot`: semester_id, owner_department_id, section_id, group_id?, day_of_week (0 = Sunday … 4 = Thursday), start_min, end_min, course_code, course_name?, room_id, source (`import` | `manual`), edited_by_hand (bool), combined_key?, published (bool), import_id?. Indexes: `{ semester_id, section_id, published }`, `{ semester_id, room_id, day_of_week }`, `{ semester_id, owner_department_id }`.
- `routine_slot_teacher`: slot_id, teacher_id. Unique `{ slot_id, teacher_id }`, index `{ teacher_id }`. A `TBA` slot has no teacher rows and `tba: true` on the slot.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/admin/imports/template?department_id=` | admin | none | `.xlsx` | none |
| `POST /api/semesters/:id/imports` | admin of dept | multipart file, department_id | 201 import summary | `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, `FILE_INFECTED`, `SEMESTER_ARCHIVED` |
| `GET /api/imports/:id/preview` | admin of dept | none | rows by section, issues, diff | `NOT_FOUND` |
| `POST /api/imports/:id/issues/:issueId/confirm` | admin of dept | none | 200 (combined class) | `VALIDATION_ERROR` |
| `PUT /api/imports/:id/keep-choices` | admin of dept | `{ slotId: 'keep' | 'replace' }` | 200 | none |
| `POST /api/imports/:id/publish` | admin of dept | warnings_reviewed: true | 200 counts | `IMPORT_HAS_ERRORS`, `ALREADY_DECIDED` (already published), `SEMESTER_ARCHIVED` |

## Jobs and events

- After commit: `routine.changed` to `section:<id>` and `user:<teacherUserId>`, and batched routine-change emails (spec 15).

## Screens

Routine import page: semester picker, template download, upload, issue list (filter errors and warnings, confirm combined classes), preview grid per section, diff view with keep/replace, publish with confirmation dialog.

## Acceptance tests

- IMP-02: an `.xlsm` file → `FILE_TYPE_NOT_ALLOWED`.
- IMP-04: Term `2` becomes `II`. Level `5` → error. Day `Fri` → error. `4-I` stays text in the downloaded template.
- IMP-08: [PRD] teacher `CSE:AA` not in the teacher list → error "Unknown teacher", and publish → `IMPORT_HAS_ERRORS`.
- IMP-10: [PRD] given a template row with room `RN: 311`, where `RN: 311` is an alias of room `311`, the row imports into room `311`. Given an unknown room, publishing is blocked.
- IMP-16: [PRD] a duplicated `CSE-301 (G1)` slot in one day → warning.
- IMP-21: two rows for sections A and B with the same teacher, room and time → overlap warning. After confirming, both slots share a `combined_key`.
- IMP-24: a re-import that drops a hand-edited slot shows it as "edited by hand", and with "keep" chosen the slot survives publishing.
- IMP-26/30: [PRD] given CSE imported a slot for LAW 1-II, when the LAW admin re-imports their own file, then the CSE slot is untouched and LAW students see both departments' slots.
- IMP-26: a CSE file with `LAW 1-II-A` rows creates section LAW 1-II-A if missing.
- IMP-28: publishing in the current semester sends exactly one email to each affected student, however many of their slots changed.
- A concurrent second publish of the same import → `ALREADY_DECIDED`.
- An EEE admin opening a CSE import → `404`.

## Decisions and open questions

- **Decision:** publishing is per import (the whole department file at once), not per section. The PRD says both "publish routines per level–term–section" and "publish with zero errors". Publishing one file at once keeps the error rule simple. Per-section visibility comes from the section existing in the file.
- **Decision:** warnings are accepted together with one "I have reviewed N warnings" confirmation, plus an individual confirmation for each combined class.
- **Decision:** the diff matches slots on (section, group, day, start time, course code). A change of room, teacher or end time counts as **changed**, and a change of day or start time counts as removed plus added.
- **Open (PRD Open question 3):** should "No class allowed" periods (prayer or lunch) be modelled as an error or warning? Not built until answered.

## Tasks

- [ ] `section`, `section_group`, `routine_import`, `routine_slot`, `routine_slot_teacher` models + indexes
- [ ] Template generator (ExcelJS) with drop-downs and text formatting
- [ ] Upload: type sniffing, size, ClamAV, GridFS
- [ ] Parser + normaliser (pure functions, heavily unit-tested)
- [ ] Validators for every error and warning (pure functions over rows + existing slots)
- [ ] Combined-class confirmation
- [ ] Diff builder + keep/replace choices
- [ ] Publish transaction (sections, groups, teachers, slots), events, cache clear, batched emails, audit
- [ ] Import page (upload, issues, preview grid, diff, publish)
- [ ] Tests, including a fixture built from the real CSE Spring 2026 sheet copied into the template
