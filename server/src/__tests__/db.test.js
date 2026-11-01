import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
const { MongoServerError } = mongoose.mongo;
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectTestDb, disconnectTestDb } from '../../test/harness.js';
import { withTransaction, assertReplicaSet, afterCommit, syncAllIndexes } from '../lib/db.js';
import { emitAfterCommit, setEmitter } from '../lib/events.js';
import { User } from '../modules/auth/auth.model.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe('database', () => {
  it('FND-06 a replica set passes the check', async () => {
    await expect(assertReplicaSet()).resolves.toBeUndefined();
  });

  it('FND-06 a standalone MongoDB is refused', async () => {
    const standalone = await MongoMemoryServer.create();
    const conn = await mongoose.createConnection(standalone.getUri()).asPromise();
    const original = mongoose.connection.db;
    try {
      const hello = await conn.db.admin().command({ hello: 1 });
      expect(hello.setName).toBeUndefined();
      // run the real check against the standalone server
      Object.defineProperty(mongoose.connection, 'db', { value: conn.db, configurable: true });
      await expect(assertReplicaSet()).rejects.toThrow(/replica set/);
    } finally {
      Object.defineProperty(mongoose.connection, 'db', { value: original, configurable: true });
      await conn.close();
      await standalone.stop();
    }
  });

  it('FND-07 withTransaction commits all writes together', async () => {
    await withTransaction(async (session) => {
      await User.create([{ kind: 'staff', state: 'active', name: 'A', email_hmac: 'tx-commit' }], {
        session,
      });
    });
    expect(await User.countDocuments({ email_hmac: 'tx-commit' })).toBe(1);
  });

  it('FND-07 withTransaction rolls back when fn throws', async () => {
    await expect(
      withTransaction(async (session) => {
        await User.create([{ kind: 'staff', state: 'active', name: 'B', email_hmac: 'tx-abort' }], {
          session,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await User.countDocuments({ email_hmac: 'tx-abort' })).toBe(0);
  });

  it('FND-07 withTransaction retries on a transient error', async () => {
    let runs = 0;
    await withTransaction(async (session) => {
      runs += 1;
      await User.create([{ kind: 'staff', state: 'active', name: 'C', email_hmac: 'tx-retry' }], {
        session,
      });
      if (runs === 1) {
        const err = new MongoServerError({ message: 'write conflict' });
        err.addErrorLabel('TransientTransactionError');
        throw err;
      }
    });
    expect(runs).toBe(2);
    expect(await User.countDocuments({ email_hmac: 'tx-retry' })).toBe(1);
  });

  it('FND-08 syncIndexes builds the unique email_hmac index', async () => {
    await syncAllIndexes();
    const indexes = await User.collection.indexes();
    expect(indexes.some((i) => i.key.email_hmac === 1 && i.unique)).toBe(true);
  });
});

describe('events', () => {
  it('FND-26 an event emitted inside a transaction is sent after the commit', async () => {
    const sent = vi.fn();
    setEmitter(sent);
    await withTransaction(async () => {
      emitAfterCommit('user:1', 'routine.changed', { id: '1' });
      expect(sent).not.toHaveBeenCalled();
    });
    expect(sent).toHaveBeenCalledWith('user:1', 'routine.changed', { id: '1' });
  });

  it('FND-26 an event emitted inside a transaction that aborts is never sent', async () => {
    const sent = vi.fn();
    setEmitter(sent);
    await expect(
      withTransaction(async () => {
        emitAfterCommit('user:1', 'routine.changed', { id: '1' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(sent).not.toHaveBeenCalled();
  });

  it('FND-26 a retried transaction sends the event once', async () => {
    const sent = vi.fn();
    setEmitter(sent);
    let runs = 0;
    await withTransaction(async () => {
      runs += 1;
      emitAfterCommit('user:1', 'booking.changed', { id: '2' });
      if (runs === 1) {
        const err = new MongoServerError({ message: 'conflict' });
        err.addErrorLabel('TransientTransactionError');
        throw err;
      }
    });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('FND-26 outside a transaction the event is sent at once', () => {
    const sent = vi.fn();
    setEmitter(sent);
    emitAfterCommit('user:1', 'calendar.changed', {});
    expect(sent).toHaveBeenCalledTimes(1);
    afterCommit(() => {});
  });
});
