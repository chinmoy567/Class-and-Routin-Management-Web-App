# Plan: 08 Routine edit

Spec: `.claude/specs/08-routine-edit.md`. It depends on 07 (built: `server/src/modules/routine/`), and through 07 on 04 semesters, 05 rooms and 06 teachers.

## Goal

After an import, the admin of department D edits single slots on a web page. The page shows one section of a draft or current semester as a Sunday–Thursday grid. Slots owned by other departments are greyed out and read-only. The admin can add, edit and delete D's slots, add a section by hand, and add, rename or remove groups.

Each save runs the import's checks on that one slot. Errors block the save. Warnings need `confirm_warnings: true`. Saves use optimistic versioning. They are audited, the routine changes at once for students, `routine.changed` is pushed, and in the current semester a batched email goes out.

## Rules and acceptance criteria

1. **EDT-01** The section grid shows all published slots of the section, by day, in the student layout. Slots of other departments carry the owner's code and `editable: false`.
2. **EDT-02** The admin of D adds a D-owned slot to any section of the semester, including another department's batch. Fields: group (optional), day, start, end, course code, course name (optional), teachers (`DEPT:CODE` list or `TBA`), room.
3. **EDT-03** Edit or delete works only on slots owned by D. Another department's admin gets `403 FORBIDDEN`. Acceptance: a CSE admin editing a LAW-owned slot in LAW 1-II-A gets 403.
4. **EDT-04** Add and edit run the import checks (spec 07 IMP-08…22) on the one slot.
   - Errors: unknown teacher, unknown room, missing field, bad day or time, end not after start, day outside Sun–Thu, and a group that doesn't exist in the section. These return `400 SLOT_INVALID` with the list, and nothing changes.
   - Warnings: teacher overlap, room overlap, section overlap, TBA, outside 08:30–17:30, duplicate course on one day, and cross-department duplicate. They return `200 {data:{saved:false, warnings}}` and save only when re-sent with `confirm_warnings: true`.
   - Combined class: an identical overlapping slot offers "combined", as in IMP-21.
5. **EDT-05** If the class's room and time have an approved booking on a future date, the response lists the bookings with requester names. The admin picks `keep_booking` or `cancel_booking` via `booking_action`. This is a no-op hook until spec 19, so no bookings are ever returned now.
6. **EDT-06** Editing an imported slot sets `edited_by_hand: true`.
7. **EDT-07** The admin adds a section by hand for their own department's batch. They add or rename groups of a section their department owns. A group can't be removed while a slot or an accepted enrolment uses it (`GROUP_IN_USE`).
8. **EDT-08** Every change is audited with old and new values. A published-slot change clears the routine cache (listener hook) and emits `routine.changed` to `section:<id>` and `user:<teacherUserId>`. In a current semester, affected students and teachers get one routine-change email per hour, batched.
9. **EDT-09** Edit and delete send `version`. A stale version returns `409 CONFLICT`. Acceptance: two admins editing the same slot → the second gets 409.
10. **EDT-10** Only an active admin of the owning department, or a super admin, can use it. CR, DCR, teachers and students get 403.
11. **Read access.** Any active admin can view any section grid of the semester (read only).
12. **Extra: semester state.** Writes on a semester that isn't draft or current return `SEMESTER_ARCHIVED` (409), as in import.
13. **Extra: conflicts.** A duplicate section returns `CONFLICT`. A duplicate group label returns `CONFLICT`.
14. **Extra: concurrency.** Two simultaneous PUTs with the same version → exactly one 200 and one 409.

## Assumptions (no open question blocks this spec)

- PRD open question 3 ("no class allowed" periods): not built, as in 07.
- Spec 19 (bookings) doesn't exist. `registerBookingClashProvider` and `registerBookingActionHandler` are hooks with no registered provider, so no clashes are ever returned.
- Spec 10 (enrolments) doesn't exist. `GROUP_IN_USE` for an accepted enrolment uses a `registerGroupUsage({inUse})` hook, the same pattern as `registerSemesterUsage`. The slot check works now. Tests register a fake provider.
- Spec 15 is not built. Email uses the existing `enqueue` with `dedupe_key = routine:<userId>:<hour bucket of clock.now()>` (institution hour, UTC-stored). The student audience comes from the existing `registerAudienceProvider`. Teachers are covered now.
- Add and edit both set `edited_by_hand: true`. IMP-24 says slots "created or edited on the edit page" are marked.
- An admin who may act for more than one department (and a super admin) must name `department_id`, resolved by the existing `resolveDepartmentScope`. A slot's `owner_department_id` is that department. A super admin editing an existing slot always acts as its owner.
- A new slot is always `published: true` and `source: 'manual'`. An edited slot keeps its source.
- Request body shape: `day_of_week` is 0–4, `start` and `end` are `HH:MM`, and `room` is a room code or alias resolved with `rooms.resolve()`. `teachers` is `"TBA"` or `["CSE:ABC", …]`. The group is the label (`G<n>`) and must already exist in the section. Groups are added in the group endpoint, not implicitly.
- Combined confirmation: body `combine_with_slot_id` is optional. The server verifies that slot is an identical overlap (room, time, teachers). The new slot then shares its `combined_key`, or a fresh one is minted. An other-department slot is never modified.
- A cross-department duplicate or overlap against own-department saved slots is treated as an ordinary overlap warning, not "cross-department".
- Legacy slots without `version` are treated as version 1 (new default 1). The publish updates `$inc` the version.
- Error codes `SLOT_INVALID`, `GROUP_IN_USE` and `CONFLICT` are added to `shared/errors.js` if missing.
- **Built differently from the plan (unattended run):**
  - The new routes were added to the existing `routineRouter` (mounted at `/api`) instead of new routers. Each service still calls `can()`; there is no separate `slot.controller.js` or `section.controller.js` (the handlers are in `routine.controller.js`).
  - `rooms` exports a new `roomCodes(ids)` so the grid can show room codes without reading the rooms collection from the routine module.
  - `lib/errors.js` supports an `extra` object on `AppError` (used for the `issues` list of `SLOT_INVALID`). The client `ApiError` keeps it as `issues`.
  - Shared `slotFormSchema` (for the browser form) is added next to the loose request schemas in `shared/schemas/slots.js`. The request schemas are loose on purpose, so a wrong or missing slot field comes back as `SLOT_INVALID` with a list.
  - Extra issue codes: `MISSING_FIELD`, `INVALID_DAY`, `INVALID_TIME`, `UNKNOWN_GROUP`, `COMBINE_NOT_ALLOWED`. `GROUP_IN_USE` and `SLOT_INVALID` were added to `shared/errors.js` (and the FND-11 list).
  - Booking clashes are looked up on add (new place), on edit only when the room, day or time changes (old and new place), and on delete (old place). `DELETE` with clashes and no `booking_action` answers `200 {saved:false, booking_clashes}`.
  - A group label is `G<n>` (1–2 digits). `PUT` may carry `section_id` to move a slot between sections of the same semester.
  - Choosing "combined" drops the matching combined-offer warnings, so only the other warnings need `confirm_warnings`.
  - The "inactive admin" test uses a deactivated admin, who has no session at all (401); a student, teacher and CR get 403.
  - The re-import diff marking (EDT-06, test 8) is covered by the existing IMP-24 tests plus the `edited_by_hand` check in the new test; no extra test was added.

## Files

**Server, `server/src/modules/routine/`**
- Changed: `routine.model.js` (`version` on the slot).
- Changed: `routine.policy.js` (`slot.view`, `slot.add`, `slot.manage`, `section.manage`).
- Changed: `routine.routes.js` (new routers).
- Changed: `index.js` (export the hook registrars).
- Changed: `validate.js` (generalise: a SECTION_OVERLAP check against saved slots in `others`; skip CROSS_DEPARTMENT_DUPLICATE when the owner is the same department). Import behaviour must stay identical, and the 07 tests guard it.
- Changed: `publish.service.js` (move the event, listener and email block into an exported `notifyRoutineChange({semester, sectionIds, teacherIds, dedupe})`; `$inc` version on the changed-slot update).
- Changed: `slots.loader.js` (return `version`, `owner_department_code`, `room_code`, `source`, `combined_key`).
- New: `slot.service.js` (add, update and delete with version check, validation, transaction, audit).
- New: `slot.validate.js` (build one normalised row from the body, resolve room and teachers, call `validateRows` with the saved slots of the semester as `others`).
- New: `section.service.js` (list sections, section grid, create section, group add, rename, delete, `registerGroupUsage`).
- New: `bookings.hooks.js` (clash provider and action handler registries).
- New: `slot.controller.js`, `section.controller.js`.
- New: `__tests__/routine-edit.api.test.js`, `__tests__/slot-validate.test.js`.

**Server, other**
- `app.js` (mount the new routers).
- `server/src/lib/errors` or `shared/errors.js` (codes).
- `test/harness.js` (nothing new expected).

**Shared**
- `shared/schemas/slots.js` (slot body, version body, section and group bodies, params and query), exported from `schemas/index.js`.

**Client, `client/src/`**
- `features/routine-edit/api.js`, `hooks.js`.
- `features/routine-edit/components/`: `WeekGrid.jsx`, `SlotDialog.jsx`, `WarningsStep.jsx`, `DeleteConfirm.jsx`, `BookingClashDialog.jsx`, `SectionManager.jsx`.
- `routes/admin/RoutineEditPage.jsx`.
- Route `/admin/routine-edit` in `App.jsx` inside `RequireAdmin`, a nav link in `AppShell.jsx`.
- `i18n/en.json` (`routineEdit.*`), `lib/query-keys.js`.
- `routes/__tests__/routine-edit.test.jsx`.

## Data model

- `routine_slot` gets `version: Number, default 1, min 1`. No new collections or indexes.
- **Add:** inside `withTransaction`, `RoutineSlot.create` + `RoutineSlotTeacher.insertMany` + `record(...)`.
- **Update:** in a transaction, `findOneAndUpdate({_id, version: sent, owner_department_id: D, semester_id}, {$set: fields, $inc: {version: 1}})`. A null result is re-read to tell 404 from `409 CONFLICT`. Then the teacher links are replaced and the audit entry is written.
- **Delete:** `findOneAndDelete({_id, version})`, then the links, then the audit entry, in one transaction.
- **Sections and groups:** the existing unique indexes (`{semester_id, department_id, level, term, letter}` and `{section_id, label}`) enforce uniqueness. A duplicate-key error (11000) is mapped to `CONFLICT`.
- **Audit actions:** `slot.create`, `slot.update`, `slot.delete`, `section.create`, `group.create`, `group.rename`, `group.delete`. Each has `scope_department_id`, `old_value` and `new_value`. The log stays append-only (insert only).
- **Booking clash:** `cancel_booking` goes through the handler registered by spec 19, in the same transaction.

## API

All routes use `requireAuth` and Zod `validate`. Failures use the standard error format.

| Method and path | `can()` check | Notes |
|---|---|---|
| `GET /api/admin/semesters/:id/sections?department_id=` | `slot.view` (any active admin) | Sections with groups and owner, optionally filtered by batch department. |
| `GET /api/admin/sections/:id/routine` | `slot.view` | Published slots with `owner_department`, `editable` (computed from the actor on the server), `version`, room code, teacher names. |
| `POST /api/slots` | `slot.add` `{department_id}` | Body: `semester_id`, `section_id`, slot fields, `department_id?`, `confirm_warnings?`, `booking_action?`, `combine_with_slot_id?`. Returns 201 `{slot}`, or 200 `{saved:false, warnings, booking_clashes?}`, or 400 `SLOT_INVALID` `{issues}`. |
| `PUT /api/slots/:id` | `slot.manage` `{department_id: slot.owner}` | Same body plus `version`. Returns 200, 400, 403, 409 `CONFLICT`. |
| `DELETE /api/slots/:id` | `slot.manage` | Body `{version}`. Returns 204, 403, 409 `CONFLICT`. |
| `POST /api/admin/sections` | `section.manage` `{department_id}` | Body: `semester_id`, `department_id`, `level`, `term`, `letter`. Returns 201, or 409 `CONFLICT`. |
| `POST /api/admin/sections/:id/groups` | `section.manage` on the section's department | Body `{label}`. Returns 201, or 409 `CONFLICT`. |
| `PATCH /api/admin/groups/:id` | same | Body `{label}`. Returns 200, or 409 `CONFLICT`. |
| `DELETE /api/admin/groups/:id` | same | Returns 204, or 409 `GROUP_IN_USE`. |

- **Policy actions.** All require an `active` account and a role of `dept_admin` or `super_admin`. `slot.view` has no department scope. The others use `isAdminOf(user, department_id)`.
- **Refusals.** CR, DCR, teacher and student get 403. Per spec, an admin of another department gets 403, not 404.
- **No private data.** Teacher names appear (the directory is not private). No email or phone is returned.
- **After commit.**
  - Emit `routine.changed` to `section:<id>` and `user:<id>` using `emitAfterCommit`.
  - Run the cache listeners.
  - In a current semester, enqueue the hourly-deduped email.
  - A move between sections notifies both the old and the new section.
- **Draft semester.** Events still go out, with no email.

## UI

`/admin/routine-edit`, mobile first (360 px), with all text in `en.json` under `routineEdit.*`.

- **Pickers:** semester (draft or current, reusing `GET /api/admin/semesters`), batch department, section. Admins with several departments, and super admins, also pick the acting department.
- **Week grid:** Sunday–Thursday as a day list on mobile and a grid on wide screens. Each slot card shows the time, course, group, teachers, room and owner code. Other departments' cards are greyed out, marked "Owned by X", and not focusable as buttons. Own cards have Edit and Delete.
- **Slot dialog:** an inline `role="dialog"` panel, like the import page. React Hook Form + Zod from `shared`. Server errors show inline per field or per issue. A second step shows the warnings with a confirm button that re-sends with `confirm_warnings: true`. A combined-class option appears when offered.
- **Booking clash dialog:** keep or cancel. It is never shown until spec 19 supplies clashes.
- **Delete confirmation** before the request.
- **Section manager:** an "Add section" form and a group list with add, rename and remove. A `GROUP_IN_USE` error is shown with a translated message.
- **409 handling:** show "changed by someone else", reload the section, and close the dialog.
- **Live refresh:** `routine.changed` over Socket.IO invalidates the section query.
- **Access:** non-admins never get the route (`RequireAdmin`), and the server enforces it anyway.

## Tests

Server API tests are named `EDT-xx …`, using Supertest and the in-memory replica set.

| # | Test |
|---|---|
| 1 | Grid returns the other department's slots with `editable:false` and the owner code; an admin of another department can view (EDT-01, 11). |
| 2 | Add a slot to own and to another department's batch section; the slot is owned by D and `published` (EDT-02). |
| 3 | A CSE admin PUTs and DELETEs a LAW-owned slot in LAW 1-II-A → 403, unchanged (EDT-03). |
| 4 | Unknown room → `SLOT_INVALID`, nothing changes. Missing field, bad day, bad time and unknown teacher → `SLOT_INVALID` (EDT-04). |
| 5 | A teacher overlap returns `saved:false` plus warnings and persists only with `confirm_warnings`. Room overlap, section overlap, TBA, outside hours and cross-department duplicate warn (EDT-04). |
| 6 | Combined-class confirm shares `combined_key` and never modifies another department's slot (EDT-04). |
| 7 | The booking-clash hook is called, and with a fake provider the `booking_action` flow works (EDT-05). |
| 8 | Editing an imported slot sets `edited_by_hand`, and the re-import diff then marks it (EDT-06). |
| 9 | Section create and duplicate → `CONFLICT`. Group add, rename and duplicate → `CONFLICT`. Delete a group used by a slot → `GROUP_IN_USE`. Delete one used by a fake accepted-enrolment provider → `GROUP_IN_USE`. An unused group is deleted. Other-department section and group management → 403 (EDT-07). |
| 10 | Audit entries carry old and new values. A current-semester edit emits `routine.changed` to the section (harness socket spy) and to the teacher's user. Two edits within the hour → one queued email per affected student (fake audience provider). A draft semester sends no email (EDT-08). |
| 11 | Stale-version PUT and DELETE → 409. Two sequential admins: the second gets 409 (EDT-09). |
| 12 | Concurrent: two simultaneous PUTs with the same version → one 200 and one 409. Concurrent adds that collide on a section → one 201 and one 409. |
| 13 | CR, DCR, teacher, student, and an inactive admin all → 403 on every route. A super admin works on any department (EDT-10). |
| 14 | Archived semester → `SEMESTER_ARCHIVED` (rule 12). |
| 15 | Zod: malformed ids and bodies → `VALIDATION_ERROR`. |
| 16 | Regression: the existing 07 import tests (`routine.api.test.js`, `units.test.js`) stay green after the `validate.js` and `publish.service.js` changes. FND-11 is updated if new codes require it. |

- **Unit test** (`slot-validate.test.js`): single-slot checks, including section overlap against saved slots and no self-overlap when editing a slot.
- **Client test** (`routine-edit.test.jsx`): the grid greys out other departments' slots, the inline server error, the warnings step and re-send, the 409 reload, the group-in-use message, and non-admin refusal.
- **Browser (Playwright):** none needed; run it only on request.

## Build order

1. Shared schemas, error codes, the `version` field, policy actions, and the `validate.js` generalisation. Run the 07 tests, then add the single-slot unit tests.
2. `slots.loader.js` additions, the grid and section list endpoints (read side), and tests 1 and 13 (read).
3. `slot.service.js` add, with errors, warnings, combined and booking hooks, and audit (tests 2, 4–7, 15).
4. Update and delete with versioning and ownership (tests 3, 8, 11, 12, 14).
5. Move the notify block out of `publish.service.js`, wire edits to it, and run the 07 tests (test 10, 16).
6. Section and group management with `registerGroupUsage` (test 9).
7. Client: api and hooks, page, grid, dialogs, i18n, route and nav, with the client test.
8. `run-checks` (lint, tests, build).
9. Walk the checklist.

## Out of scope

- Bulk changes and re-import (spec 07).
- Real approved-booking data and the cancel-and-email behaviour (spec 19).
- The enrolment model, and the routine cache itself (specs 10, 12).
- The spec 15 email-template design, and the "No class allowed" periods.
- Moving a slot between departments' ownership.
- Deleting or closing whole sections.
- A drag-and-drop grid.
