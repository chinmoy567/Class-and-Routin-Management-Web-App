import { AsyncLocalStorage } from 'node:async_hooks';
import dns from 'node:dns';
import mongoose from 'mongoose';

const txStore = new AsyncLocalStorage();

export async function connectDb(url, { dnsServers = '' } = {}) {
  const servers = dnsServers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) dns.setServers(servers);
  await mongoose.connect(url);
  await assertReplicaSet();
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

/** FND-06: transactions need a replica set. Refuse to run without one. */
export async function assertReplicaSet() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error('MongoDB is not running as a replica set; transactions are unavailable.');
  }
}

/** FND-08: build every model's indexes (development and test only). */
export async function syncAllIndexes() {
  for (const name of mongoose.connection.modelNames()) {
    await mongoose.connection.model(name).syncIndexes();
  }
}

/**
 * Run `fn(session)` in a transaction (snapshot reads, majority writes, automatic retry on
 * transient errors). `fn` may run more than once, so it must only touch the database.
 * Callbacks registered with `afterCommit()` run once, after the commit succeeds.
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    let hooks = [];
    await txStore.run({ add: (cb) => hooks.push(cb) }, async () => {
      await session.withTransaction(
        async () => {
          hooks = [];
          result = await fn(session);
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    });
    for (const cb of hooks) await cb();
    return result;
  } finally {
    await session.endSession();
  }
}

/** Is the caller inside withTransaction()? */
export const inTransaction = () => Boolean(txStore.getStore());

/** Run `cb` after the surrounding transaction commits, or immediately outside a transaction. */
export function afterCommit(cb) {
  const store = txStore.getStore();
  if (store) store.add(cb);
  else return cb();
}
