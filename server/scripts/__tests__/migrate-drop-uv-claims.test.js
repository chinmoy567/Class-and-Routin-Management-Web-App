import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { clearDb, connectTestDb, disconnectTestDb } from '../../test/harness.js';
import { makeUser } from '../../test/factories.js';
import { migrateUvClaims } from '../migrate-drop-uv-claims.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearDb();
  const db = mongoose.connection.db;
  if ((await db.listCollections({ name: 'uv_claim' }).toArray()).length) {
    await db.collection('uv_claim').drop();
  }
});

const db = () => mongoose.connection.db;

/** The old data shape, written straight to the collections (the model no longer exists). */
async function oldData() {
  const approved = await makeUser({ kind: 'student', state: 'active' });
  const pendingOnly = await makeUser({ kind: 'student', state: 'claim_pending' });
  const alreadySet = await makeUser({ kind: 'student', state: 'active', uv_id: '999' });
  await db()
    .collection('uv_claim')
    .insertMany([
      { user_id: approved._id, uv_id_text: '0822310205101077', status: 'approved' },
      { user_id: pendingOnly._id, uv_id_text: '0822310205101078', status: 'pending' },
      { user_id: alreadySet._id, uv_id_text: '0822310205101079', status: 'approved' },
    ]);
  await db()
    .collection('user')
    .updateOne({ _id: pendingOnly._id }, { $set: { claim_rejections: { count: 2 } } });
  await db().collection('enrolment').insertOne({
    user_id: approved._id,
    semester_id: new mongoose.Types.ObjectId(),
    section_id: new mongoose.Types.ObjectId(),
    status: 'accepted',
    uv_claim_id: new mongoose.Types.ObjectId(),
  });
  return { approved, pendingOnly, alreadySet };
}

const user = (id) => db().collection('user').findOne({ _id: id });

describe('spec 24 one-off script: copy approved UV IDs, drop uv_claim', () => {
  it('--dry-run reports what it would do and changes nothing', async () => {
    const { approved } = await oldData();
    const result = await migrateUvClaims(db(), { dryRun: true });
    expect(result).toMatchObject({
      dry_run: true,
      uv_claim_collection: true,
      approved_claims: 2,
      uv_ids_copied: 1,
      profiles_already_set_or_not_students: 1,
      enrolment_links_removed: 1,
      rejection_counters_removed: 1,
      collection_dropped: false,
    });
    expect((await user(approved._id)).uv_id).toBeUndefined();
    expect(await db().collection('uv_claim').countDocuments()).toBe(3);
  });

  it('copies each approved UV ID into the profile, keeps an existing one, cleans up and drops the collection', async () => {
    const { approved, pendingOnly, alreadySet } = await oldData();
    const result = await migrateUvClaims(db(), { dryRun: false });
    expect(result.collection_dropped).toBe(true);
    expect((await user(approved._id)).uv_id).toBe('0822310205101077');
    expect((await user(pendingOnly._id)).uv_id).toBeUndefined();
    expect((await user(pendingOnly._id)).claim_rejections).toBeUndefined();
    expect((await user(alreadySet._id)).uv_id).toBe('999');
    expect(
      await db()
        .collection('enrolment')
        .countDocuments({ uv_claim_id: { $exists: true } }),
    ).toBe(0);
    expect(await db().listCollections({ name: 'uv_claim' }).toArray()).toHaveLength(0);
  });

  it('is safe to run twice, and on a database that never had uv_claim', async () => {
    await oldData();
    await migrateUvClaims(db(), { dryRun: false });
    const again = await migrateUvClaims(db(), { dryRun: false });
    expect(again).toMatchObject({ uv_claim_collection: false, uv_ids_copied: 0 });
  });
});
