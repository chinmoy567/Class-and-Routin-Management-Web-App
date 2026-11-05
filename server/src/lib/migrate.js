import { clock } from './time.js';
import { logger } from './logger.js';

/**
 * OPS-07: run each migration once and record it in the `migrations` collection.
 *
 * A migration is `{ name, up(db) }`. The name is claimed first with an insert into a collection
 * that has a unique index on `name`, so two runs at the same time cannot both apply it. A claim
 * with no `ran_at` is a migration that failed (or is still running); it is removed on failure so
 * the next run can retry it.
 */
export async function runMigrations(db, migrations, { log = logger } = {}) {
  const records = db.collection('migrations');
  await records.createIndex({ name: 1 }, { unique: true });
  const applied = [];
  const skipped = [];
  for (const migration of migrations) {
    if (!migration?.name || typeof migration.up !== 'function') {
      throw new Error('A migration needs a name and an up() function.');
    }
    try {
      await records.insertOne({ name: migration.name, started_at: clock.now() });
    } catch (err) {
      if (err?.code === 11000) {
        skipped.push(migration.name);
        continue;
      }
      throw err;
    }
    try {
      await migration.up(db);
      await records.updateOne({ name: migration.name }, { $set: { ran_at: clock.now() } });
      applied.push(migration.name);
      log.info({ migration: migration.name }, 'migration applied');
    } catch (err) {
      await records.deleteOne({ name: migration.name, ran_at: { $exists: false } });
      log.error({ err, migration: migration.name }, 'migration failed');
      throw err;
    }
  }
  return { applied, skipped };
}
