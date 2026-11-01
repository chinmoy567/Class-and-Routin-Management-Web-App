import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet;

/** FND-34: one MongoMemoryReplSet per test run (a replica set, so transactions work). */
export async function setup() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.TEST_MONGO_URI = replSet.getUri();
}

export async function teardown() {
  await replSet?.stop();
}
