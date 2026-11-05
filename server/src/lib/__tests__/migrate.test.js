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
