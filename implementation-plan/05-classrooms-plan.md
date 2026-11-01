# Plan: Spec 05 – Classrooms

(Spec: `.claude/specs/05-classrooms.md`, the only match for `05-classrooms`. The `specs/` path in the command does not exist; specs live in `.claude/specs/`. After approval this is saved to `implementation-plan/05-classrooms-plan.md`.)

## Goal
Department admins keep their department's rooms: one canonical code per room (unique across the university), aliases (sheet spellings), and sharing departments. This is the only place rooms are created. A new **rooms** module (listed in CLAUDE.md) exports `resolve(text)` for the routine import (spec 07) and routine edit (spec 08), plus an in-use hook for `ROOM_IN_USE`. Free-room view (13) and booking (19) are NOT built.

## Rules and acceptance criteria
1. ROOM-01 Admin of dept D (or any super admin) creates a room owned by D: code 1–20 chars (trimmed, inner spaces collapsed), unique university-wide case-insensitively; type `classroom|lab`; no capacity. Duplicate in any dept → `CONFLICT`.
2. ROOM-02 Owner's admin adds/removes aliases. Alias unique across **all room codes and aliases**, compared trim + collapse spaces + case-insensitive (`rn:  311` vs `RN: 311` → `CONFLICT`; alias equal to another room's code → `CONFLICT`). Check of both collections inside one transaction.
3. ROOM-03 `resolve(text)` matches code or alias with the same normalisation; returns the room or `null`. Exported from `rooms/index.js`. (`' rn: 311 '` and `'RN: 311'` → room `311`.)
4. ROOM-04 Owner's admin adds/removes sharing departments (`PUT .../shares`, replace set). Admin of a sharing department can **not** edit the room itself (403). (Deciding requests is spec 19; here only the share data is stored. **Departure:** the planned `isRoomDecider` helper was not built, spec 19 owns it.)
5. ROOM-05 Owner's admin renames the code; old code becomes an alias automatically (same transaction); `resolve(oldCode)` still returns the room.
6. ROOM-06 Retire (no delete). Retired room: not offered to new slots/requests, `resolve()` returns `null` for it (import shows "unknown room"). Retire refused with `ROOM_IN_USE` (409) while a published slot of the current or draft semester uses it.
7. ROOM-07 Audit create, edit (rename/type), alias add, alias remove, shares change, retire (same transaction as the change).
8. ROOM-08 Any signed-in `active` user lists active rooms (`id, code, type` only). Only admins see aliases and sharing departments.
9. Permissions table: create = admin of the owner dept or super admin; edit/aliases/shares/retire = admin of owner or super admin; list = any `active` user. Account state must be `active`.
10. DEP-14 scope: a dept admin acting on another department's room/department → 403; reading a single other-department room → 404.
11. DEP-02 (spec 03) follow-up: a department's code is locked once any room refers to it → rooms module registers `registerDepartmentUsage({ codeLocked })`.

## Blockers / open questions
- PRD "Open questions": none block this spec (Q3 blocked periods only affects later specs).
- Decisions I will take unless you object:
  1. New module `server/src/modules/rooms/` (CLAUDE.md lists `rooms`; spec 05 names `rooms.resolve`). Talks to organisation only via its exports (`getDepartment`, `isActiveDepartment`, `departmentNames`, `registerDepartmentUsage`).
  2. `resolve()` returns `null` for **retired** rooms (ROOM-06 "import shows unknown room"); an `{ includeRetired: true }` option exists for later specs.
  3. "Published slot uses it" has no data yet (routine slots arrive in spec 07). Same pattern as spec 03/04: `registerRoomUsage({ inUse })` provider registry; with none registered a room is retirable. The test registers a fake provider; spec 07/08 register the real one.
  4. Retired rooms are read-only (no edit/alias/share change) → `CONFLICT` with a clear message; no un-retire in this spec (spec says "retired, not deleted" only). Their code and aliases stay reserved.
  5. Alias length 1–40 chars (spec gives none). Alias may not equal its own room's current code (CONFLICT).
  6. Cross-collection uniqueness (code vs alias) can't be a single DB index, so a one-document **guard** (`room_name_guard`, like `allowed_domain_guard`, mongo-patterns §6) is written first in every create/rename/alias transaction. Concurrent writers conflict and serialise; the per-collection unique indexes remain the backstop.
  7. UI uses inline forms and `window.confirm` (the existing DepartmentsPage pattern) instead of modal dialogs; the spec's "dialogs" is not a requirement of behaviour.
  8. `GET /api/admin/rooms` for a dept admin with another `department_id` → 403; super admin without `department_id` → all rooms.

## Files
**shared/**
- `schemas/rooms.js` (new): `roomCode` (trim, collapse spaces, 1–20), `roomAlias`, `createRoomBody {code,type,department_id}`, `updateRoomBody {code?,type?}` (at least one), `createAliasBody`, `setSharesBody {department_ids[]}` (ids unique), `roomIdParam`, `roomAliasParams`, `adminRoomsQuery {department_id?}`; `ROOM_TYPES` in `enums.js` if not present.
- `schemas/index.js` export; `errors.js` add `ROOM_IN_USE` (409); `__tests__/shared.test.js` cases.

**server/src/modules/rooms/** (new)
- `rooms.model.js`: `Room`, `RoomAlias`, `RoomShare`, `RoomNameGuard`.
- `normalise.js`: `normaliseName(text)` (trim, collapse whitespace, lower-case).
- `rooms.service.js`: `listActiveRooms`, `listAdminRooms`, `createRoom`, `updateRoom`, `addAlias`, `removeAlias`, `setShares`, `retireRoom`, `resolve`, `registerRoomUsage`, `resetRoomUsage`, `roomsShareView`.
- `rooms.policy.js`: `room.list`, `room.create`, `room.manage` (resource = room), `room.admin_list`.
- `rooms.controller.js`, `rooms.routes.js` (`roomsRouter` at `/api/rooms`, `roomsAdminRouter` at `/api/admin`).
- `index.js`: register policies; call `registerDepartmentUsage({ codeLocked })`; export routers, `resolve`, `registerRoomUsage`, `resetRoomUsage`, `Room`.
- `__tests__/rooms.api.test.js`, `__tests__/rooms.resolve.test.js`.

**server/** changes: `src/app.js` mount the two routers (`requireAuth`); `src/__tests__/app.test.js` only if it lists routes.

**client/src/**
- `features/rooms/api.js`, `hooks.js` (or add to `features/admin`; I'll use a new `features/rooms/` folder).
- `lib/query-keys.js`: `rooms`, `adminRooms(departmentId)`.
- `routes/admin/ClassroomsPage.jsx` (new); `components/RequireAdmin.jsx` (new, super admin **or** dept admin; a `useIsAdmin` hook in `features/auth/hooks.js`).
- `App.jsx`: route `/admin/classrooms` inside `RequireAdmin`. `components/AppShell.jsx`: nav item "Classrooms" for any admin.
- `i18n/en.json`: `nav.adminClassrooms`, `admin.classrooms.*`, `errors.ROOM_IN_USE`.
- `routes/__tests__/classrooms.test.jsx` (new).

## Data model
- `room` (collection `room`): `code`, `code_norm`, `type` enum, `owner_department_id`, `retired` (default false), `retired_at?`, timestamps. Indexes: unique `{code_norm}`; `{owner_department_id, retired}`.
- `room_alias`: `alias`, `alias_norm`, `room_id`, `created_at`. Indexes: unique `{alias_norm}`; `{room_id}`.
- `room_share`: `room_id`, `department_id`. Unique `{room_id, department_id}`; `{department_id}`.
- `room_name_guard`: one doc `{_id:'rooms', version}`, `$inc` first in each name-changing transaction.
- No partial unique indexes needed (all uniques are unconditional; retired rooms keep their names reserved).
- Transactions (via `withTransaction`): create room (guard, check code_norm vs alias_norm, insert, audit); rename (guard, collision check, update code, insert old code as alias, drop own matching alias if renamed back, audit); add alias (guard, collision check, insert, audit); set shares (replace, audit with before/after); retire (conditional `findOneAndUpdate({_id, retired:false})`, audit). Retire runs the in-use providers first, again inside the transaction is not possible for external data, so the check precedes it (same as spec 04).
- "First action wins": retire uses a conditional update; a second retire is idempotent (no second audit entry).
- Duplicate-key errors (11000) map to `CONFLICT`.

## API (`{data}` responses, Zod via `validate()`, CSRF global)
| Endpoint | can() | Notes / audit |
|---|---|---|
| `GET /api/rooms` | `room.list` (state `active`) | `[{id,code,type}]` active rooms only, sorted by code |
| `GET /api/admin/rooms?department_id=` | `room.admin_list` (active admin; `isAdminOf` the dept) | `{owned:[{id,code,type,retired,aliases:[{id,alias}],shares:[{department_id,code,name}]}], shared_with_me:[{id,code,type,owner:{code,name}}]}` (shared list read-only, no aliases) |
| `POST /api/admin/rooms` | `room.create` with `{department_id}` resource | 201; owner dept must exist and not be retired (else 400 `VALIDATION_ERROR` on `department_id`); audit `room.create` |
| `PATCH /api/admin/rooms/:id` | `room.manage` (state active, `isAdminOf(owner dept)`) | 200; rename adds old-code alias; audit `room.update` (old/new) |
| `POST /api/admin/rooms/:id/aliases` | `room.manage` | 201; audit `room.alias_add` |
| `DELETE /api/admin/rooms/:id/aliases/:aliasId` | `room.manage` | 204; alias must belong to that room else 404; audit `room.alias_remove` |
| `PUT /api/admin/rooms/:id/shares` | `room.manage` | 200; owner dept in list or unknown/retired dept → `VALIDATION_ERROR`; audit `room.shares_update` |
| `POST /api/admin/rooms/:id/retire` | `room.manage` | 200; in use → `ROOM_IN_USE`; audit `room.retire` |
Room-by-id policies use the DEP-14 rule: a non-admin (or admin without scope who has no admin role at all) gets the normal 403 for actions; single-record reads of another department's room give 404. Audit `scope_department_id` = owner dept.

## UI
`/admin/classrooms` (any admin; super admin gets a department picker, dept admin is fixed to their own department from `me.roles`): list of the department's rooms (code, type, alias chips with remove button, sharing departments), "Add room" form, edit form (code, type), add-alias form, shares editor (checkbox list of other active departments), retire button with confirm. A separate read-only section "Shared with your department". Server field errors shown under fields; `CONFLICT`/`ROOM_IN_USE` shown with translated text. All text in `en.json`, labels/aria, 360 px layout, no hard-coded strings.

## Tests (named `ROOM-0x …`)
- Server `rooms.api.test.js`:
  - #1 create ok + audit; same code in another dept → `CONFLICT` (case-insensitive); length 0/21 → 400; 5 parallel creates of one code → exactly one 201 (concurrency).
  - #2 `rn:  311` vs `RN: 311` → `CONFLICT`; alias equal to another room's code → `CONFLICT`; a room code equal to an existing alias → `CONFLICT`; parallel code-create vs alias-add of the same name → exactly one wins (guard).
  - #3 `resolve` service tests: both spellings, unknown → null, retired → null.
  - #4 EEE admin PATCH/alias/shares/retire on a CSE room shared with EEE → 403; owner can change shares; owner in shares list → 400.
  - #5 rename `LR-407B`→`407B`: `resolve('LR-407B')` works, alias listed, audit; rename back removes the alias; rename to a taken name → `CONFLICT`.
  - #6 fake in-use provider → `ROOM_IN_USE`; unused room retires, disappears from `GET /api/rooms`, resolve null; second retire no second audit; edits to a retired room refused.
  - #7 each of the six audit actions present.
  - #8 `GET /api/rooms` for active student/teacher returns code+type only (no aliases/shares); non-`active` states (e.g. `unconfirmed`, `deactivated`) refused; unauthenticated 401; admin list for students/teachers 403.
  - #9/#10 cross-scope: CSE admin creating in EEE → 403; CSE admin listing `?department_id=EEE` → 403; reading EEE room by id as CSE admin → 404; super admin acts in any dept; student/teacher/unconfirmed blocked on every admin endpoint.
  - #11 department code change refused (`CODE_LOCKED`) once it has a room.
- Shared schema tests (code/alias normalisation, shares).
- Client `classrooms.test.jsx`: list renders aliases/shares, add-room error display (`CONFLICT`), retire error `ROOM_IN_USE`, dept admin sees page+nav, student does not.

## Build order
1. Shared schemas, `ROOM_IN_USE`, tests. 2. Models, indexes, `normalise`, `resolve` (+ resolve tests). 3. Service: create / list (+ API tests incl. concurrency). 4. Alias add/remove, rename, shares, retire, usage registry, audit (+ tests). 5. Policies, routes, controller, mount in `app.js`, `codeLocked` registration. 6. Client api/hooks/keys, `RequireAdmin`, nav, `ClassroomsPage`, i18n (+ client tests). 7. `run-checks` (lint, tests, build) and checklist review. Spec status/tasks file is left alone unless you ask; no commit.

## Out of scope
Free-room view (13), booking and who-decides on requests (19), routine slots / the real `ROOM_IN_USE` data (07/08), un-retiring a room, bulk room import, room capacity, department "readiness" screens, modal dialog components.

## Verification
`npm test -w @crm/shared`, `npm test -w @crm/server`, `npm test -w @crm/client`, `npm run lint`, `npm run build`; walk the checklist above against passing tests.

## Departures from this plan (recorded during implementation)
- No `isRoomDecider` helper (spec 19 owns who-decides).
- There is no single-room read endpoint, so the "404 on reading another department's room" case has no endpoint; tests cover 403 on actions and 404 for an unknown id.
- A deactivated admin is signed out by the session layer, so those requests get 401 (not 403); the test accepts any refusal (>= 401).
- The existing AUTH-17 tests used `/api/rooms` as an unmounted placeholder route; they now use `/api/not-a-route`.
- `server/test/harness.js` imports the rooms model so its indexes are built in tests.
