// Spec 22, SAF-12 to SAF-14: the nightly retention job. Three idempotent passes, each in batches of
// 1,000. Held messages (SAF-09) are never touched. Conversations are kept, even when empty.
import { subMonths } from 'date-fns';
import { clock } from '../../lib/time.js';
import { logger } from '../../lib/logger.js';
import { deleteChatFile } from '../../lib/gridfs.js';
import { Message } from './chat.model.js';

export const RETENTION_JOB = 'chat.retention';
export const BATCH_SIZE = 1000; // SAF-14
const DELETED_GRACE_DAYS = 30; // SAF-13

/** SAF-09: a message is held while `hold_open` is set or `hold_until` is still in the future. */
const notHeld = (now) => ({
  hold_open: { $ne: true },
  // Missing, null or in the past: not held. (No $or here, so callers can add their own.)
  hold_until: { $not: { $gt: now } },
});

/** Erase the stored bytes of the messages' files, then the messages in one call. */
async function purgeMessages(ids, { deleteRows }) {
  const files = await Message.find({ _id: { $in: ids }, file_id: { $ne: null } })
    .select('file_id')
    .lean();
  for (const f of files) await deleteChatFile(f.file_id);
  if (deleteRows) {
    await Message.deleteMany({ _id: { $in: ids } });
  } else {
    await Message.updateMany({ _id: { $in: ids } }, { $unset: { body_enc: 1, file_id: 1 } });
  }
}

/** SAF-12: messages older than 12 months by send date are deleted for good. */
async function purgeOld(now) {
  const cutoff = subMonths(now, 12);
  let total = 0;
  for (;;) {
    const rows = await Message.find({ created_at: { $lt: cutoff }, ...notHeld(now) })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('_id')
      .lean();
    if (!rows.length) return total;
    await purgeMessages(
      rows.map((r) => r._id),
      { deleteRows: true },
    );
    total += rows.length;
  }
}

/** SAF-13: a deleted message's text and file are erased 30 days after the deletion. */
async function eraseDeleted(now) {
  const cutoff = new Date(now.getTime() - DELETED_GRACE_DAYS * 24 * 60 * 60 * 1000);
  let total = 0;
  for (;;) {
    const rows = await Message.find({
      deleted_at: { $ne: null, $lte: cutoff },
      $or: [{ body_enc: { $exists: true } }, { file_id: { $ne: null } }],
      ...notHeld(now),
    })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('_id')
      .lean();
    if (!rows.length) return total;
    await purgeMessages(
      rows.map((r) => r._id),
      { deleteRows: false },
    );
    total += rows.length;
  }
}

/** SAF-09: holds whose time has passed are released (the message can then be purged by the rules). */
async function releaseExpiredHolds(now) {
  const res = await Message.updateMany({ hold_until: { $lt: now } }, { $unset: { hold_until: 1 } });
  return res.modifiedCount ?? 0;
}

/**
 * SAF-12 to SAF-14: run the three passes. Safe to run again: each pass only picks what is still due.
 * Logs counts only, never message text.
 */
export async function runRetention() {
  const now = clock.now();
  const purged = await purgeOld(now);
  const erased = await eraseDeleted(now);
  const released = await releaseExpiredHolds(now);
  logger.info({ purged, erased, released }, 'chat retention run');
  return { purged, erased, released };
}
