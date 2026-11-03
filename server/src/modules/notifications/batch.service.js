import { getAgenda } from '../../lib/jobs.js';
import { clock } from '../../lib/time.js';
import { EmailBatch } from './email.model.js';
import { enqueue } from './mail.service.js';

export const FLUSH_JOB = 'email.flush_batch';
const HOUR_MS = 3600 * 1000;

/**
 * EML-06: add one item to a person's pending batch of `kind`. A publish (`flushNow`) sends the
 * batch at once. A hand edit sends it one hour after the first item (`flush_scheduled` makes sure
 * only one flush is booked). So a person gets at most one email per hour from edits.
 */
export async function addToBatch({ userId, kind, item, semesterName = '', flushNow = false }) {
  const doc = await upsertBatch({ userId, kind, item, semesterName });
  if (flushNow) {
    await scheduleFlush(doc._id, clock.now());
    return;
  }
  if (doc.flush_scheduled) return;
  // Only one caller wins the flag; the others see it set and book nothing.
  const booked = await EmailBatch.updateOne(
    { _id: doc._id, flush_scheduled: { $ne: true } },
    { $set: { flush_scheduled: true } },
  );
  if (booked.modifiedCount === 1) {
    await scheduleFlush(doc._id, new Date(doc.first_at.getTime() + HOUR_MS));
  }
}

async function upsertBatch({ userId, kind, item, semesterName }) {
  const update = {
    $push: { items: item },
    $setOnInsert: { first_at: clock.now() },
    $set: { semester_name: semesterName },
  };
  try {
    return await EmailBatch.findOneAndUpdate({ user_id: userId, kind }, update, {
      upsert: true,
      new: true,
    }).lean();
  } catch (err) {
    // Two adds for one person at the same moment: the unique index lets one insert win; retry.
    if (err.code !== 11000) throw err;
    return EmailBatch.findOneAndUpdate({ user_id: userId, kind }, update, { new: true }).lean();
  }
}

/**
 * The flush is tied to one batch document, not to a person and kind. A flush booked for an
 * earlier batch must never send a later batch before its own hour is up.
 */
async function scheduleFlush(batchId, when) {
  await getAgenda().schedule(when, FLUSH_JOB, { batch_id: String(batchId) });
}

/**
 * Job handler: take this batch (atomically, so nothing is sent twice) and send one email with
 * every item. If sending fails, the items go back under the same id so the retried job finds them.
 */
export async function flushBatch({ batch_id }) {
  const doc = await EmailBatch.findOneAndDelete({ _id: batch_id }).lean();
  if (!doc || doc.items.length === 0) return false;
  try {
    await enqueue({
      to_user_id: doc.user_id,
      template: doc.kind,
      data: { semester: doc.semester_name, changes: doc.items.join('\n') },
      dedupe_key: `batch:${doc._id}`,
    });
  } catch (err) {
    await EmailBatch.updateOne(
      { _id: doc._id },
      {
        $push: { items: { $each: doc.items } },
        $setOnInsert: {
          user_id: doc.user_id,
          kind: doc.kind,
          first_at: doc.first_at,
          semester_name: doc.semester_name,
          flush_scheduled: false,
        },
      },
      { upsert: true },
    );
    throw err;
  }
  return true;
}
