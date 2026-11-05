import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { clearDb, connectTestDb, disconnectTestDb } from '../../../test/harness.js';
import { runMigrations } from '../migrate.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearDb();
  await mongoose.connection.db.collection('migrations').deleteMany({});
});

const db = () => mongoose.connection.db;
const silent = { info() {}, error() {} };

describe('OPS-07 migration runner', () => {
  it('OPS-07 runs a migration once and records it with a name and ran_at', async () => {
    let runs = 0;
    const migrations = [{ name: '001-add-flag', up: async () => (runs += 1) }];
    const first = await runMigrations(db(), migrations, { log: silent });
    const second = await runMigrations(db(), migrations, { log: silent });
    expect(runs).toBe(1);
    expect(first.applied).toEqual(['001-add-flag']);
    expect(second.skipped).toEqual(['001-add-flag']);
    const row = await db().collection('migrations').findOne({ name: '001-add-flag' });
    expect(row.ran_at).toBeInstanceOf(Date);
  });

  it('OPS-07 two runs at the same time apply each migration once', async () => {
    let runs = 0;
    const migrations = [
      {
        name: '002-slow',
        up: async () => {
          await new Promise((r) => setTimeout(r, 50));
          runs += 1;
        },
      },
    ];
    await Promise.all([
      runMigrations(db(), migrations, { log: silent }),
      runMigrations(db(), migrations, { log: silent }),
    ]);
    expect(runs).toBe(1);
  });

  it('OPS-07 a failed migration is not recorded, so the next run retries it', async () => {
    let attempt = 0;
    const migrations = [
      {
        name: '003-flaky',
        up: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error('boom');
        },
      },
    ];
    await expect(runMigrations(db(), migrations, { log: silent })).rejects.toThrow('boom');
    expect(await db().collection('migrations').countDocuments({ name: '003-flaky' })).toBe(0);
    const result = await runMigrations(db(), migrations, { log: silent });
    expect(result.applied).toEqual(['003-flaky']);
  });

  it('OPS-07 rejects a migration without a name or up()', async () => {
    await expect(runMigrations(db(), [{ name: 'x' }], { log: silent })).rejects.toThrow(
      'needs a name',
    );
  });
});

describe('OPS-07 migration files', () => {
  it('OPS-07 loads files in name order and rejects a file whose name does not match', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { loadMigrationFiles } = await import('../migrate.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(
      path.join(dir, '002-b.js'),
      "export default { name: '002-b', up: async () => {} };",
    );
    fs.writeFileSync(
      path.join(dir, '001-a.js'),
      "export default { name: '001-a', up: async () => {} };",
    );
    fs.writeFileSync(path.join(dir, 'README.md'), 'not a migration');
    const loaded = await loadMigrationFiles(dir);
    expect(loaded.map((m) => m.name)).toEqual(['001-a', '002-b']);

    fs.writeFileSync(
      path.join(dir, '003-c.js'),
      "export default { name: 'wrong', up: async () => {} };",
    );
    await expect(loadMigrationFiles(dir)).rejects.toThrow('must be "003-c"');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
