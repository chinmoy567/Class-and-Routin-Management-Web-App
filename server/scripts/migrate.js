// OPS-07: run pending migrations from server/migrations/ against MONGO_URL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { getConfig } from '../src/config.js';
import { runMigrations } from '../src/lib/migrate.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.js'))
  .sort();
const migrations = [];
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(dir, f)).href);
  const name = f.replace(/\.js$/, '');
  if (mod.default?.name !== name) throw new Error(`${f}: name must match the file name`);
  migrations.push(mod.default);
}

await mongoose.connect(getConfig().MONGO_URL);
try {
  const { applied, skipped } = await runMigrations(mongoose.connection.db, migrations);
  console.log(`migrations: ${applied.length} applied, ${skipped.length} already done`);
} finally {
  await mongoose.disconnect();
}
