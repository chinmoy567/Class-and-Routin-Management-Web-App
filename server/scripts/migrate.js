// OPS-07: run pending migrations from server/migrations/ against MONGO_URL.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { getConfig } from '../src/config.js';
import { loadMigrationFiles, runMigrations } from '../src/lib/migrate.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const migrations = await loadMigrationFiles(dir);

await mongoose.connect(getConfig().MONGO_URL);
try {
  const { applied, skipped } = await runMigrations(mongoose.connection.db, migrations);
  console.log(`migrations: ${applied.length} applied, ${skipped.length} already done`);
} finally {
  await mongoose.disconnect();
}
