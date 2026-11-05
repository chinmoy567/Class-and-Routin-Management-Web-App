import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import request from 'supertest';
import { connectTestDb, disconnectTestDb, buildTestApp } from '../../test/harness.js';
import { makeUser } from '../../test/factories.js';
import { createSessionMiddleware } from '../app.js';
import { getConfig } from '../config.js';
import { initSocket } from '../lib/socket.js';
import { emitAfterCommit } from '../lib/events.js';
import { withTransaction } from '../lib/db.js';

let server;
let io;
let url;

beforeAll(async () => {
  await connectTestDb();
  const sessionMiddleware = createSessionMiddleware(getConfig());
  const app = buildTestApp({ sessionMiddleware });
  server = http.createServer(app);
  io = initSocket(server, sessionMiddleware);
  await new Promise((r) => server.listen(0, r));
  url = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  io.close();
  await new Promise((r) => server.close(r));
  await disconnectTestDb();
});

async function cookieFor(user) {
  const res = await request(url)
    .get('/api/__test__/login')
    .query({ userId: String(user._id) });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

describe('socket', () => {
  it('FND-25 an unauthenticated socket is rejected', async () => {
    const socket = connect(url, { transports: ['websocket'], reconnection: false });
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('UNAUTHENTICATED');
    socket.close();
  });

  it('FND-25 a signed-in socket joins user:<id> and receives events for it only', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const cookieA = await cookieFor(alice);
    const cookieB = await cookieFor(bob);
    const a = connect(url, { transports: ['websocket'], extraHeaders: { cookie: cookieA } });
    const b = connect(url, { transports: ['websocket'], extraHeaders: { cookie: cookieB } });
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    // wait for the server side to finish joining the rooms
    await new Promise((r) => setTimeout(r, 200));

    let bobGot = false;
    b.on('routine.changed', () => (bobGot = true));
    const received = once(a, 'routine.changed');
    await withTransaction(async () => {
      emitAfterCommit(`user:${alice._id}`, 'routine.changed', { section_id: 's1' });
    });
    expect(await received).toEqual({ section_id: 's1' });
    await new Promise((r) => setTimeout(r, 200));
    expect(bobGot).toBe(false);
    a.close();
    b.close();
  });
});
