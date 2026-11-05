import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import request from 'supertest';
import { connectTestDb, disconnectTestDb, buildTestApp } from '../../test/harness.js';
import { createDepartment, makeUser } from '../../test/factories.js';
import { Semester } from '../modules/organisation/index.js';
import { Section, sectionRoomsFor } from '../modules/routine/index.js';
import { Enrolment } from '../modules/enrolments/index.js';
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

describe('section push rooms (BKG-20)', () => {
  it('BKG-20 a CR and an accepted student hear their section push; a student of another section does not', async () => {
    const semester = await Semester.create({
      name: 'Socket term',
      start_date: '2027-03-28',
      end_date: '2027-10-04',
      status: 'current',
    });
    const dept = await createDepartment({ code: 'CSE' });
    const mk = (letter) =>
      Section.create({
        semester_id: semester._id,
        department_id: dept._id,
        level: 3,
        term: 'II',
        letter,
      });
    const secA = await mk('A');
    const secB = await mk('B');
    const cr = await makeUser({
      kind: 'student',
      state: 'active',
      roles: [{ role: 'cr', section_id: secA._id, semester_id: semester._id }],
    });
    const studentB = await makeUser({ kind: 'student', state: 'active' });
    await Enrolment.create({
      user_id: studentB._id,
      semester_id: semester._id,
      section_id: secB._id,
      department_id: dept._id,
      status: 'accepted',
    });
    const studentA = await makeUser({ kind: 'student', state: 'active' });
    await Enrolment.create({
      user_id: studentA._id,
      semester_id: semester._id,
      section_id: secA._id,
      department_id: dept._id,
      status: 'accepted',
    });

    // A server wired the way server.js wires it: each connection joins its section rooms.
    const sessionMiddleware = createSessionMiddleware(getConfig());
    const app2 = buildTestApp({ sessionMiddleware });
    const server2 = http.createServer(app2);
    const io2 = initSocket(server2, sessionMiddleware, {
      onConnect: async (socket) => {
        for (const room of await sectionRoomsFor(socket.data.userId)) socket.join(room);
      },
    });
    await new Promise((r) => server2.listen(0, r));
    const url2 = `http://127.0.0.1:${server2.address().port}`;
    const connectAs = async (user) => {
      const s = connect(url2, {
        transports: ['websocket'],
        extraHeaders: { cookie: await cookieFor(user) },
      });
      await once(s, 'connect');
      return s;
    };
    const sockets = [await connectAs(cr), await connectAs(studentA), await connectAs(studentB)];
    await new Promise((r) => setTimeout(r, 200)); // let the server finish joining rooms

    const heard = (s) =>
      new Promise((resolve) => {
        s.once('booking.changed', () => resolve(true));
        setTimeout(() => resolve(false), 400);
      });
    const pending = sockets.map(heard);
    emitAfterCommit(`section:${secA._id}`, 'booking.changed', {});
    const [crHeard, studentAHeard, studentBHeard] = await Promise.all(pending);
    expect(crHeard).toBe(true);
    expect(studentAHeard).toBe(true);
    expect(studentBHeard).toBe(false);

    sockets.forEach((s) => s.close());
    io2.close();
    await new Promise((r) => server2.close(r));
  });
});
