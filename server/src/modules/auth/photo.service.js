import { User } from './auth.model.js';
import { assertProfileState } from './profile.service.js';
import { sniffImage } from '../../lib/imageType.js';
import {
  deletePhotoFile,
  getPhotoFile,
  putPhoto,
  readPhoto,
  setPhotoScanStatus,
  streamPhoto,
} from '../../lib/gridfs.js';
import { scanBuffer } from '../../lib/clamav.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getAgenda } from '../../lib/jobs.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024; // PRF-04
export const PHOTO_SCAN_JOB = 'photo.scan';

const wrongType = () =>
  new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'Use a JPEG, PNG or WebP image.');

/**
 * PRF-04: check the file by its content, store it as the user's pending photo and queue the scan.
 * The old photo (or the initials) stays in use until the scan passes.
 */
export async function uploadPhoto(actor, body) {
  assertProfileState(actor, 'profile.edit_own');
  if (!Buffer.isBuffer(body) || body.length === 0) throw wrongType();
  if (body.length > PHOTO_MAX_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'The photo must be 2 MB or smaller.');
  }
  const content_type = sniffImage(body);
  if (!content_type) throw wrongType();

  const fileId = await putPhoto(body, {
    owner_id: String(actor._id),
    scan_status: 'pending',
    content_type,
  });
  // A newer upload replaces one that is still waiting for its scan.
  const before = await User.findOneAndUpdate(
    { _id: actor._id },
    { $set: { pending_photo_file_id: fileId }, $unset: { photo_scan_failed_at: 1 } },
    { returnDocument: 'before' },
  )
    .select('pending_photo_file_id')
    .lean();
  await deletePhotoFile(before?.pending_photo_file_id);
  await getAgenda().now(PHOTO_SCAN_JOB, { fileId: String(fileId), userId: String(actor._id) });
  return { scan_status: 'pending' };
}

/** PRF-04, PRF-08: remove the photo (and any waiting one). The initials are shown again. */
export async function deletePhoto(actor) {
  assertProfileState(actor, 'profile.edit_own');
  await withTransaction(async (session) => {
    const before = await User.findOneAndUpdate(
      { _id: actor._id },
      { $unset: { photo_file_id: 1, pending_photo_file_id: 1, photo_scan_failed_at: 1 } },
      { returnDocument: 'before', session },
    )
      .select('photo_file_id pending_photo_file_id')
      .lean();
    await record({
      actor,
      action: 'user.photo_change',
      target: { type: 'user', id: actor._id },
      new_value: { removed: true },
      session,
    });
    afterCommit(async () => {
      await deletePhotoFile(before?.photo_file_id);
      await deletePhotoFile(before?.pending_photo_file_id);
    });
  });
}

/**
 * The `photo.scan` job. Safe to run twice (FND-22) and safe when a newer upload has replaced the
 * file: the promotion only happens if this file is still the one waiting.
 */
export async function scanPhoto({ fileId, userId }) {
  const user = await User.findById(userId).select('photo_file_id pending_photo_file_id').lean();
  if (String(user?.photo_file_id) === String(fileId)) return; // already promoted
  if (!user || String(user.pending_photo_file_id) !== String(fileId)) {
    await deletePhotoFile(fileId); // replaced or removed while waiting
    return;
  }

  // A scanner that cannot be reached throws here, so the job is retried and the photo stays pending.
  const result = await scanBuffer(await readPhoto(fileId));

  if (result.infected) {
    await withTransaction(async (session) => {
      const changed = await User.updateOne(
        { _id: userId, pending_photo_file_id: fileId },
        { $unset: { pending_photo_file_id: 1 }, $set: { photo_scan_failed_at: clock.now() } },
        { session },
      );
      if (changed.modifiedCount) afterCommit(() => deletePhotoFile(fileId));
    });
    return;
  }

  await withTransaction(async (session) => {
    const before = await User.findOneAndUpdate(
      { _id: userId, pending_photo_file_id: fileId },
      {
        $set: { photo_file_id: fileId },
        $unset: { pending_photo_file_id: 1, photo_scan_failed_at: 1 },
      },
      { returnDocument: 'before', session },
    )
      .select('photo_file_id')
      .lean();
    if (!before) return; // replaced while scanning
    await record({
      actor: { _id: user._id, roles: [] },
      action: 'user.photo_change',
      target: { type: 'user', id: userId },
      new_value: { removed: false },
      session,
    });
    afterCommit(async () => {
      await setPhotoScanStatus(fileId, 'clean');
      await deletePhotoFile(before.photo_file_id);
    });
  });
}

/** PRF-04: only the clean photo is ever served, and only to signed-in users. */
export async function sendUserPhoto(userId, res) {
  const user = await User.findById(userId).select('photo_file_id').lean();
  const file = user?.photo_file_id && (await getPhotoFile(user.photo_file_id));
  if (!file) throw notFound();
  res.set({
    'Content-Type': file.metadata?.content_type ?? 'application/octet-stream',
    'Cache-Control': 'private, max-age=300',
    'Content-Length': String(file.length),
  });
  await new Promise((resolve, reject) => {
    const stream = streamPhoto(file._id);
    stream.on('error', reject);
    res.on('close', resolve);
    stream.pipe(res);
  });
}
