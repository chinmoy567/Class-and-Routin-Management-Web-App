# 05: Classrooms

R1 · Status: Draft · Depends on: 03 · PRD: Admin dashboard and controls (Classrooms), Classroom booking rules (Who decides), Import template and checks (Unknown room) · Diagrams: 05-er-diagram

## Goal

Each department admin keeps their department's rooms: one canonical code per room, the spellings used in routine sheets (aliases), and the other departments that share the room. This is the **only** place rooms are created. The routine import never creates rooms.

## Scope

**In:** create, edit and retire rooms; aliases; sharing departments; resolving a code or alias to a room (used by import and edit).

**Out:** free-room view (spec 13), booking (spec 19).

## Requirements

- **ROOM-01** An admin of department D can create a room owned by D with a code (1–20 characters, trimmed, unique across the university, case-insensitive, for example `311` or `LR-407B`) and a type (`classroom` | `lab`). Capacity is not tracked.
- **ROOM-02** Aliases: the owner's admin can add and remove aliases (for example `RN: 311`, `LR-407B: AI Lab`). An alias is unique across all room codes and aliases, compared case-insensitively with whitespace collapsed.
- **ROOM-03** `rooms.resolve(text)` finds a room by code or alias using the same normalisation (trim, collapse spaces, case-insensitive). It returns the room or `null`. It is used by routine import and routine edit.
- **ROOM-04** The owner's admin can add or remove **sharing departments**. The admin of the owner or of any sharing department can decide the room's requests (spec 19). Only the owner's admin can edit the room itself.
- **ROOM-05** The owner's admin can rename a room's code. The old code automatically becomes an alias, so existing sheets still match.
- **ROOM-06** A room can be retired, not deleted. A retired room can't be used by new routine slots or requests, and import shows "unknown room" for it. It can't be retired while a published slot of the current or draft semester uses it (`ROOM_IN_USE`).
- **ROOM-07** Every create, edit, alias change, sharing change and retire is audited.
- **ROOM-08** Any signed-in `active` user can list active rooms with code and type (needed by the free-room view). Only admins see aliases and sharing departments.

## Permissions

| Action | Admin of owner | Admin of sharing dept | Super admin | Others |
|---|---|---|---|---|
| Create room (owned by own dept) | ✔ | n/a | ✔ (any dept) | ✘ |
| Edit, aliases, sharing, retire | ✔ | ✘ | ✔ | ✘ |
| List rooms (code, type) | ✔ | ✔ | ✔ | `active` users |

## Data

- `room`: code, code_norm (unique), type, owner_department_id, retired (bool).
- `room_alias`: alias, alias_norm (unique), room_id.
- `room_share`: room_id, department_id. Unique `{ room_id, department_id }`.
- A code and an alias must not collide: the service checks both collections inside a transaction before inserting.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/rooms` | `active` users | none | `[{ id, code, type }]` | none |
| `GET /api/admin/rooms?department_id=` | admin | none | rooms with aliases and shares | none |
| `POST /api/admin/rooms` | admin of dept | code, type, department_id | 201 | `CONFLICT` |
| `PATCH /api/admin/rooms/:id` | admin of owner | code?, type? | 200 | `CONFLICT` |
| `POST /api/admin/rooms/:id/aliases` | admin of owner | alias | 201 | `CONFLICT` |
| `DELETE /api/admin/rooms/:id/aliases/:aliasId` | admin of owner | none | 204 | none |
| `PUT /api/admin/rooms/:id/shares` | admin of owner | department_ids[] | 200 | `VALIDATION_ERROR` |
| `POST /api/admin/rooms/:id/retire` | admin of owner | none | 200 | `ROOM_IN_USE` |

## Screens

Classrooms page (admin): table of the department's rooms with type, aliases (chips) and sharing departments; add, edit and retire dialogs. Rooms shared *with* the admin's department are listed separately and are read-only.

## Acceptance tests

- ROOM-01: creating `311` when `311` exists in another department → `CONFLICT`.
- ROOM-02: adding alias `rn:  311` when alias `RN: 311` exists → `CONFLICT`. An alias equal to another room's code → `CONFLICT`.
- ROOM-03: `resolve('RN: 311')` and `resolve(' rn: 311 ')` both return room `311`. [PRD] A template row with room `RN: 311`, where `RN: 311` is an alias of room `311`, imports into room `311` (checked in spec 07).
- ROOM-04: an EEE admin editing a CSE room shared with EEE → `403`.
- ROOM-05: after renaming `LR-407B` to `407B`, `resolve('LR-407B')` returns the room.
- ROOM-06: retiring a room used by a published slot of the current semester → `ROOM_IN_USE`.

## Decisions and open questions

- **Decision:** room codes are unique across the whole university, not per department, so a sheet that names `311` means one room.
- **Decision:** renaming keeps the old code as an alias (ROOM-05).

## Tasks

- [ ] Models + normalisation helper + indexes
- [ ] `resolve()` service function (exported via `index.js`)
- [ ] Admin endpoints with the collision check in a transaction + audit
- [ ] Public list endpoint
- [ ] Classrooms page
- [ ] Tests
