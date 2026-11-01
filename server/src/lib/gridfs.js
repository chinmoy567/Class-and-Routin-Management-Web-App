import mongoose from 'mongoose';

const bucket = () =>
  new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'photos' });

/** Store a photo and return its file id. */
export async function putPhoto(buffer, metadata) {
  const upload = bucket().openUploadStream(`photo-${metadata.owner_id}`, { metadata });
  await new Promise((resolve, reject) => {
    upload.on('error', reject);
    upload.on('finish', resolve);
    upload.end(buffer);
  });
  return upload.id;
}

export async function getPhotoFile(fileId) {
  return mongoose.connection.db.collection('photos.files').findOne({ _id: toId(fileId) });
}

export async function readPhoto(fileId) {
  const chunks = [];
  for await (const chunk of bucket().openDownloadStream(toId(fileId))) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export const streamPhoto = (fileId) => bucket().openDownloadStream(toId(fileId));

export async function setPhotoScanStatus(fileId, scan_status) {
  await mongoose.connection.db
    .collection('photos.files')
    .updateOne({ _id: toId(fileId) }, { $set: { 'metadata.scan_status': scan_status } });
}

/** Deleting a file that is already gone is not an error. */
export async function deletePhotoFile(fileId) {
  if (!fileId) return;
  try {
    await bucket().delete(toId(fileId));
  } catch (err) {
    // The driver reports a missing file as "File not found for id …" (or FileNotFound).
    if (!/file\s*not\s*found/i.test(`${err?.code} ${err?.name} ${err?.message}`)) throw err;
  }
}

export async function ensurePhotoIndex() {
  await mongoose.connection.db.collection('photos.files').createIndex({ 'metadata.owner_id': 1 });
}

function toId(id) {
  return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
}
