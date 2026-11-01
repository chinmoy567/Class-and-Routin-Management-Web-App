---
name: api-module
description: The standard shape of a back-end module in server/src/modules/ (auth, organisation, routine, calendar, rooms, chat, notifications, audit) - folder layout, the order to build in, Zod validation, can() policy checks, audit entries, error format, what a module may export, and its tests. Use when creating a new module, or adding an endpoint, model, service or route to an existing one.
---

# Building a back-end module

Every module in `server/src/modules/` has the same shape, so any developer, or Claude, can find their way around any module. Data rules (indexes, transactions, "first action wins") are covered by the **mongo-patterns** skill. Read it too when a module writes data.

## Folder layout

```
server/src/
  app.js                  Express app: middleware, mounts each module's router
  server.js               starts HTTP + Socket.IO
  lib/
    db.js                 connection + withTransaction()
    errors.js             AppError + error middleware
    validate.js           validate({ body, query, params }) middleware
    time.js               Asia/Dhaka helpers (now(), toInstitutionDate(), minutesOfDay()…)
    crypto.js             encrypt/decrypt, emailHmac()
  policy/
    can.js                can(user, action, resource), assertCan(); merges every module's rules
  modules/
    rooms/
      index.js            the ONLY file other modules may import from
      rooms.routes.js     Express router: paths, validate(), requireAuth, calls the controller
      rooms.controller.js turns HTTP into service calls: reads req, calls the service, sends the response
      rooms.service.js    business logic: loads data, assertCan(), rules, transactions, audit
      rooms.model.js      Mongoose schemas + indexes (one file per collection if it gets large)
      rooms.schemas.js    Zod schemas for request bodies, queries and params
      rooms.policy.js     this module's rules for can()
      rooms.jobs.js       Agenda job definitions (only if the module has jobs)
      rooms.events.js     socket events this module sends (only if needed)
      __tests__/
        rooms.service.test.js
        rooms.api.test.js
```

## Layers and what each one may do

| Layer | Does | Must not |
|---|---|---|
| routes | path, HTTP method, `requireAuth`, `validate()` | contain logic |
| controller | read `req.user` and the validated input, call one service function, shape the response | touch Mongoose, decide permissions |
| service | load resources, `assertCan()`, apply PRD rules, run transactions, write audit entries, queue emails/events after commit | read `req`/`res` |
| model | schema, indexes, small helpers | call other modules |
| policy | pure functions: may this user do this action on this resource? | hit the database (the service loads what the policy needs first) |

**Between modules:** a module imports another only through its `index.js`, for example `import { roomsService } from '../rooms/index.js'`. Never import another module's model or read its collections directly.

## Order to build in

1. **Zod schemas** (`*.schemas.js`) for every input, built from the PRD's rules (lengths, 5-minute boundaries, enums). Export them so the client can reuse them.
2. **Model** with every index the PRD's data model lists.
3. **Policy rules** (`*.policy.js`), one per action, for example `'room_request.create'` or `'room_request.decide'`.
4. **Service functions**, each taking `(actor, input)` and following mongo-patterns for any multi-document write.
5. **Controller + routes.** Mount the router in `app.js`.
6. **Tests** (see below), written alongside each step, not at the end.

## Validation

```js
// rooms.routes.js
router.post('/room-requests', requireAuth, validate({ body: createRoomRequestBody }), ctrl.createRequest);
```

`validate()` replaces `req.body`, `req.query` and `req.params` with the parsed values and rejects bad input with `400 VALIDATION_ERROR` and a list of field errors. Never trust a field the client sends that the server can work out itself, such as "sections I teach", the requester's department or the current time.

## Authorization with `can()`

```js
// rooms.policy.js
export const roomsPolicy = {
  'room_request.create': (user, { section }) =>
    user.state === 'active' &&
    (hasRole(user, 'teacher') || hasRole(user, ['cr', 'dcr'], { section_id: section._id })),

  'room_request.decide': (user, { room }) =>
    hasRole(user, 'super_admin') ||
    hasRole(user, 'dept_admin', { department_id: [room.owner_department_id, ...room.shared_department_ids] }),
};

// rooms.service.js
const room = await Room.findById(input.room_id).lean();
assertCan(actor, 'room_request.decide', { room }); // throws AppError(403, 'FORBIDDEN')
```

- Every policy checks **account state**, **role** and **scope** (department, section, semester). The PRD's "What each state can use" table is the source of truth for state.
- `requireAuth` only proves the user is signed in. Permission is always decided in the service, after loading the resource.
- A user with no right to a resource gets `404` when even knowing it exists would leak information (another department's student, for example), and `403` otherwise.

## Audit

Each action listed in the PRD's "Auditability" requirement calls `audit.record({ actor, action, target, old_value, new_value, session })` inside the same transaction. Action names follow the `<resource>.<verb>` pattern used in the policy (`room_request.approve`).

## Errors and responses

```js
throw new AppError(409, 'REQUEST_LIMIT', 'You already have 3 open requests at this time.');
```

- Success: `{ data: … }`. Lists: `{ data: [...], page: { next } }`.
- Error: `{ error: { code: 'REQUEST_LIMIT', message: '…', fields?: {…} } }`.
- `code` is a stable UPPER_SNAKE string the client uses to pick a translated message. `message` is an English fallback.
- Unknown errors return `500 INTERNAL` with no details. The full error goes to pino.

## Privacy in responses

Never return `email_enc`, `phone_enc`, `password_hash` or `email_hmac`. Build response objects explicitly (with a `toPublic(user)` helper) rather than sending Mongoose documents. Email and phone go out only in the cases the PRD's Privacy rule allows.

## Background jobs and push events

- Jobs live in `*.jobs.js` and are registered with Agenda at startup. A job must be safe to run twice (use conditional updates, as in mongo-patterns §2).
- Socket events (`booking.changed`…) and emails are sent **after** the transaction commits, never inside it.

## Tests for every module

`__tests__/*.api.test.js` use Supertest against `app`, with a `MongoMemoryReplSet` database. Each endpoint needs:

- the happy path,
- every PRD rule that can block it (one test each, checking the error `code`),
- **permission tests:** every role that must be refused, including a user from **another department** and **another section**,
- **state tests:** each account state that must be refused (for example `claim_pending` opening My routine gets 403),
- concurrency tests for anything in mongo-patterns,
- an audit entry written for every audited action.
