// Spec 24, one-off: copy each approved UV ID claim into the student's profile (`user.uv_id`), then
// remove what the claim left behind: `enrolment.uv_claim_id`, `user.claim_rejections` and the
// `uv_claim` collection. Safe to run twice. A profile that already has a UV ID is left as it is.
//
//   npm run migrate:drop-uv-claims -w @crm/server -- --dry-run   (report only, writes nothing)
//   npm run migrate:drop-uv-claims -w @crm/server                (do it)
//
// Never logs a UV ID, an email or a phone; only counts.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** Runs against a connected `mongoose.connection.db`. Returns counts of what was (or would be) done. */
export async function migrateUvClaims(db, { dryRun = true } = {}) {
  const exists = (await db.listCollections({ name: 'uv_claim' }).toArray()).length > 0;
  const claims = exists
    ? await db
        .collection('uv_claim')
        .find({ status: 'approved' }, { projection: { user_id: 1, uv_id_text: 1 } })
        .toArray()
    : [];
  const users = db.collection('user');
  let copied = 0;
  let kept = 0;
  for (const c of claims) {
    if (!c.user_id || !/^\d{1,20}$/.test(String(c.uv_id_text ?? ''))) continue;
    const target = { _id: c.user_id, kind: 'student', uv_id: { $exists: false } };
    if (!(await users.countDocuments(target, { limit: 1 }))) {
      kept++;
      continue;
    }
    copied++;
    if (!dryRun) await users.updateOne(target, { $set: { uv_id: String(c.uv_id_text) } });
  }
  const enrolmentLinks = await db
    .collection('enrolment')
    .countDocuments({ uv_claim_id: { $exists: true } });
  const rejectionCounters = await users.countDocuments({ claim_rejections: { $exists: true } });
  if (!dryRun) {
    await db
      .collection('enrolment')
      .updateMany({ uv_claim_id: { $exists: true } }, { $unset: { uv_claim_id: '' } });
    await users.updateMany(
      { claim_rejections: { $exists: true } },
      { $unset: { claim_rejections: '' } },
    );
    if (exists) await db.collection('uv_claim').drop();
  }
  return {
    dry_run: dryRun,
    uv_claim_collection: exists,
    approved_claims: claims.length,
    uv_ids_copied: copied,
    profiles_already_set_or_not_students: kept,
    enrolment_links_removed: enrolmentLinks,
    rejection_counters_removed: rejectionCounters,
    collection_dropped: exists && !dryRun,
  };
}

async function main() {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  const { getConfig } = await import('../src/config.js');
  const { connectDb, disconnectDb } = await import('../src/lib/db.js');
  const config = getConfig();
  const conn = await connectDb(config.MONGO_URL, { dnsServers: config.DNS_SERVERS });
  try {
    const result = await migrateUvClaims(conn.db, { dryRun: values['dry-run'] });
    console.log(JSON.stringify(result, null, 2));
    if (result.dry_run) console.log('Dry run: nothing was changed.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
