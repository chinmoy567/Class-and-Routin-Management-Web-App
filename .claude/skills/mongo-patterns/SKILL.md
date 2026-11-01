---
name: mongo-patterns
description: How to implement this project's data-integrity rules in MongoDB + Mongoose - room_slot_lock (no double-booking), partial unique indexes, "first action wins" conditional updates, transactions (3-request limit, booking approval), and the append-only audit_log. Use whenever writing or changing a Mongoose model, an index, an approval/decision endpoint, a booking or request flow, or anything that writes to more than one document at once.
---

# MongoDB patterns for this project

The PRD's data rules (Technical approach → Core data model and Concurrency rules) must be enforced by the **database**, not only by application code. These are the standard ways to do it. Use them as written. If a case doesn't fit, stop and ask.

## Ground rules

- MongoDB runs as a **replica set**, both in development and in tests (`MongoMemoryReplSet` from mongodb-memory-server). Transactions don't work without one.
- Stored field names follow the PRD's data model exactly (`room_id`, `email_hmac`, `block_start`…), so the PRD, the ER diagram and the database all match.
- Every index is declared in the Mongoose schema. Call `Model.syncIndexes()` on startup in development and in test setup.
- Times are stored in UTC. A calendar date (for example the date of a booking) is stored as a `'YYYY-MM-DD'` string in institution time (`Asia/Dhaka`), worked out on the server with date-fns-tz. A time of day is stored as **minutes since midnight** (11:35 → 695).
- Always pass `{ session }` to every read and write inside a transaction. A query without it reads outside the transaction and silently breaks the guarantee.

## 1. Transaction helper

Every multi-document write goes through one helper (in `server/src/lib/db.js`):

```js
import mongoose from 'mongoose';

export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    // withTransaction retries automatically on TransientTransactionError (write conflicts)
    await session.withTransaction(async () => {
      result = await fn(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally {
    await session.endSession();
  }
}
```

`fn` may run more than once, so it must have no side effects outside the database (no emails, no socket events). Send those **after** the transaction commits.

## 2. "First action wins" (join requests, ID claims, room requests)

Make the state change conditional on the old state. Never read the document, check its status, then save it.

```js
const decided = await JoinRequest.findOneAndUpdate(
  { _id: id, status: 'pending' },
  { $set: { status: 'accepted', decided_by: actor._id, decided_at: new Date() } },
  { new: true, session }
);
if (!decided) throw new AppError(409, 'ALREADY_DECIDED', 'This request was already decided.');
```

Return `409 ALREADY_DECIDED`. The page shows "already decided".

## 3. Partial unique indexes ("at most one", "unique where")

```js
// At most one current semester
semesterSchema.index({ status: 1 }, { unique: true, partialFilterExpression: { status: 'current' } });

// At most one accepted enrolment per user per semester
enrolmentSchema.index(
  { user_id: 1, semester_id: 1 },
  { unique: true, partialFilterExpression: { status: 'accepted' } }
);

// One approved claim per UV ID (pending claims don't reserve it)
uvClaimSchema.index({ uv_id_norm: 1 }, { unique: true, partialFilterExpression: { status: 'approved' } });

// teacher.user_id unique only when set
teacherSchema.index({ user_id: 1 }, { unique: true, partialFilterExpression: { user_id: { $type: 'objectId' } } });
```

`partialFilterExpression` supports only equality, `$exists: true`, `$type`, comparisons, and `$and`. It doesn't support `$ne` or `$in`, so filter on the value you want (`status: 'approved'`), not on the values you don't.

Turn a duplicate-key error (`err.code === 11000`) into a clear `409` with a message about the rule that was broken, for example "This UV ID is already approved for another student."

## 4. No double-booking: `room_slot_lock`

Each approved booking writes one lock document per **5-minute block** it covers. The unique index makes overlapping approvals impossible.

```js
const roomSlotLockSchema = new Schema({
  room_id: { type: ObjectId, ref: 'Room', required: true },
  date: { type: String, required: true },        // 'YYYY-MM-DD', Asia/Dhaka
  block_start: { type: Number, required: true }, // minutes since midnight, multiple of 5
  room_request_id: { type: ObjectId, ref: 'RoomRequest', required: true },
});
roomSlotLockSchema.index({ room_id: 1, date: 1, block_start: 1 }, { unique: true });

export function blocksFor(startMin, endMin) {
  const blocks = [];
  for (let t = startMin; t < endMin; t += 5) blocks.push(t); // end is exclusive
  return blocks;
}
```

**Why 5 minutes:** request times sit on 5-minute boundaries, and ranges that only touch (10:00–11:00 and 11:00–12:00) must not clash. With bigger blocks, two bookings that only touch could land in the same block and falsely clash. The PRD says "for example 10 minutes", but 5 is the correct size for its own rules.

**Overlap test** (used everywhere a rule says "same time"): `a.start < b.end && b.start < a.end`. As a query, with `start` and `end` as the new request's times:

```js
{ room_id, date, status: 'pending', start_min: { $lt: end }, end_min: { $gt: start } }
```

Cancelling a booking deletes its locks (in the same transaction as the status change), so the room becomes free at once.

## 5. Booking approval (one transaction)

```js
export async function approveRoomRequest(actor, requestId) {
  const result = await withTransaction(async (session) => {
    const req = await RoomRequest.findOneAndUpdate(
      { _id: requestId, status: 'pending' },
      { $set: { status: 'approved', decided_by: actor._id, decided_at: new Date() }, $inc: { version: 1 } },
      { new: true, session }
    );
    if (!req) throw new AppError(409, 'ALREADY_DECIDED', 'This request was already decided.');

    await assertCan(actor, 'room_request.decide', req);           // room's department or a sharing department
    await recheckRequestRules(req, { session });                   // all send-time checks again, plus the 2 h cutoff

    try {
      await RoomSlotLock.insertMany(
        blocksFor(req.start_min, req.end_min).map((b) => ({
          room_id: req.room_id, date: req.date, block_start: b, room_request_id: req._id,
        })),
        { session, ordered: true }
      );
    } catch (err) {
      if (err.code === 11000) throw new AppError(409, 'ALREADY_DECIDED', 'This room is already booked at that time.');
      throw err;
    }

    const overlap = { date: req.date, status: 'pending', start_min: { $lt: req.end_min }, end_min: { $gt: req.start_min } };
    // Same requester's other overlapping requests: cancelled
    await RoomRequest.updateMany({ ...overlap, ...requesterFilter(req), _id: { $ne: req._id } },
      { $set: { status: 'cancelled', cancel_reason: 'another_request_approved' } }, { session });
    // Other requesters' requests for the same room and time: rejected
    await RoomRequest.updateMany({ ...overlap, room_id: req.room_id, _id: { $ne: req._id } },
      { $set: { status: 'rejected', reject_reason: 'room_given_to_another' } }, { session });

    await audit.record({ actor, action: 'room_request.approve', target: req, session });
    return req;
  });

  // After the commit: emails and socket events
  notifyBookingDecided(result);
  return result;
}
```

`requesterFilter(req)` returns `{ requester_section_id }` or `{ requester_teacher_id }`.

## 6. The 3-request limit

Counting alone is a race: two CRs press send at once, both count 2, and both insert. To prevent it, **write to the requester's document first** inside the transaction. Two concurrent transactions then write-conflict, MongoDB aborts one, `withTransaction` retries it, and the retry sees the other's insert.

```js
await withTransaction(async (session) => {
  const Requester = input.requester_section_id ? Section : Teacher;
  const requesterId = input.requester_section_id ?? input.requester_teacher_id;

  await Requester.updateOne({ _id: requesterId }, { $inc: { request_seq: 1 } }, { session }); // the serialising write

  const open = await RoomRequest.countDocuments({
    ...requesterFilter(input), date: input.date, status: 'pending',
    start_min: { $lt: input.end_min }, end_min: { $gt: input.start_min },
  }, { session });
  if (open >= 3) throw new AppError(409, 'REQUEST_LIMIT', 'You already have 3 open requests at this time.');

  await RoomRequest.create([{ ...input, status: 'pending', version: 0 }], { session });
});
```

The limit is per requester (the section, shared by its CR and DCRs, or the teacher). It applies only to pending requests that overlap the new request's time.

## 7. Append-only `audit_log`

Use two layers of protection:

1. **Database user:** the app's MongoDB user gets a custom role with only `find` and `insert` on `audit_log` (set up in the Mongo init script). This is the real guarantee.
2. **Model guard:** block any update or delete in code, so a mistake fails loudly in tests:

```js
const forbid = function () { throw new Error('audit_log is append-only'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne',
                  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace']) {
  auditLogSchema.pre(op, forbid);
}
auditLogSchema.pre('save', function (next) { if (!this.isNew) return next(new Error('audit_log is append-only')); next(); });
```

Write audit entries **inside** the same transaction as the action they record, so an action is never saved without its log entry.

## 8. Encrypted email and HMAC lookup

- `email_enc` and `phone_enc` hold AES-256-GCM ciphertext (IV + tag + data). The key comes from an environment variable, never from the database.
- `email_hmac` = HMAC-SHA256 of the trimmed, lower-cased email, using a separate secret. It has a unique index. Sign-in and the "email already taken" check look accounts up by `email_hmac` only.
- Never select `email_enc` or `phone_enc` by default (`select: false` in the schema). Read them only in the code paths the PRD's Privacy rule allows.

## Tests every pattern needs

- **Concurrency:** use `Promise.all` to fire two approvals of overlapping requests at once. Exactly one succeeds and the other gets `409 ALREADY_DECIDED`.
- **Request limit:** four overlapping requests sent at the same time leave exactly 3 pending.
- **Touching ranges:** 10:00–11:00 and 11:00–12:00 in the same room can both be approved.
- **Partial indexes:** a second accepted enrolment, current semester or approved claim is refused.
- **Audit log:** any update or delete on it throws.
