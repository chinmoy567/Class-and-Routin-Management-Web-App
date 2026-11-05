import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { clearDb, connectTestDb, disconnectTestDb } from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { Section } from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { loadRequestUser } from '../../auth/index.js';
import { initSocket } from '../../../lib/socket.js';
import { onRepAssigned } from '../chat.group.service.js';
import { sendMessage } from '../chat.messages.service.js';
import { removeMember } from '../chat.group.service.js';
import { Conversation } from '../chat.model.js';
import '../index.js'; // registers the socket connect hook

// A stand-in for the session: the test passes the user id in a header.
const fakeSession = (req, _res, next) => {
  req.session = { userId: req.headers['x-test-user'] };
  next();
};

let server;
let io;
let port;
const clients = [];

beforeAll(async () => {
  await connectTestDb();
  server = http.createServer();
  io = initSocket(server, fakeSession);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
afterAll(async () => {
  for (const c of clients) c.disconnect();
  io.close();
  await new Promise((resolve) => server.close(resolve));
  await disconnectTestDb();
});
beforeEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await clearDb();
});

/** Connect a socket as `userId`, and resolve once its server-side room joins have run. */
async function socketFor(userId) {
  const socket = connect(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: { 'x-test-user': String(userId) },
  });
  clients.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

/** Poll the server until `predicate()` holds, or fail after 2 s. */
async function until(predicate, label) {
  const start = Date.now();
  while (Date.now() - start < 2000) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out: ${label}`);
}

const inRoom = async (room, userId) => {
  const sockets = await io.in(room).fetchSockets();
  return sockets.some((s) => String(s.data.userId) === String(userId));
};

async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const sem = await Semester.create({
    name: 'Fall 2026',
    status: 'current',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
  });
  const secA = await Section.create({
    semester_id: sem._id,
    department_id: cse._id,
    level: 2,
    term: 'II',
    letter: 'A',
  });
  const secB = await Section.create({
    semester_id: sem._id,
    department_id: cse._id,
    level: 2,
    term: 'II',
    letter: 'B',
  });
  const cr = await makeUser({
    kind: 'student',
    state: 'active',
    name: 'CR A',
    roles: [
      {
        role: 'cr',
        department_id: cse._id,
        section_id: secA._id,
        semester_id: sem._id,
        is_representative: true,
      },
    ],
  });
  const crB = await makeUser({
    kind: 'student',
    state: 'active',
    name: 'CR B',
    roles: [
      {
        role: 'cr',
        department_id: cse._id,
        section_id: secB._id,
        semester_id: sem._id,
        is_representative: true,
      },
    ],
  });
  const student = async (name, sec) => {
    const u = await makeUser({ kind: 'student', state: 'active', name, departmentId: cse._id });
    await Enrolment.create({
      user_id: u._id,
      semester_id: sem._id,
      section_id: sec._id,
      department_id: cse._id,
      status: 'accepted',
    });
    return u;
  };
  const w = {
    sem,
    secA,
    secB,
    cr,
    crB,
    s1: await student('Student One', secA),
    s2: await student('Student Two', secA),
    other: await student('Student B', secB),
    teacher: await makeUser({
      kind: 'teacher',
      state: 'active',
      name: 'Teacher T',
      departmentId: cse._id,
    }),
  };
  await onRepAssigned({ id: String(secA._id) });
  await onRepAssigned({ id: String(secB._id) });
  w.groupA = await Conversation.findOne({ type: 'section_group', section_id: secA._id }).lean();
  w.groupB = await Conversation.findOne({ type: 'section_group', section_id: secB._id }).lean();
  return w;
}

describe('CHT-20 socket rooms, decided by the server', () => {
  it('CHT-20 a member socket joins its open group room on connect', async () => {
    const w = await world();
    await socketFor(w.s1._id);
    await until(() => inRoom(`conversation:${w.groupA._id}`, w.s1._id), 'member joins');
    expect(await inRoom(`conversation:${w.groupA._id}`, w.s1._id)).toBe(true);
  });

  it('CHT-20 a teacher cannot join a section group room', async () => {
    const w = await world();
    await socketFor(w.teacher._id);
    await new Promise((r) => setTimeout(r, 150));
    expect(await inRoom(`conversation:${w.groupA._id}`, w.teacher._id)).toBe(false);
  });

  it('CHT-20 a client request to join another group room is ignored', async () => {
    const w = await world();
    const socket = await socketFor(w.s1._id);
    socket.emit('join', `conversation:${w.groupB._id}`);
    socket.emit('socketsJoin', `conversation:${w.groupB._id}`);
    await new Promise((r) => setTimeout(r, 150));
    expect(await inRoom(`conversation:${w.groupB._id}`, w.s1._id)).toBe(false);
  });

  it('CHT-14 a member receives message.new with ids only; a non-member receives nothing', async () => {
    const w = await world();
    const member = await socketFor(w.s1._id);
    const outsider = await socketFor(w.other._id);
    await until(() => inRoom(`conversation:${w.groupA._id}`, w.s1._id), 'member joins');
    const received = [];
    const outsiderReceived = [];
    member.on('message.new', (p) => received.push(p));
    outsider.on('message.new', (p) => outsiderReceived.push(p));
    const me = await loadRequestUser(w.s1._id);
    const sent = await sendMessage(me, w.groupA._id, 'live text');
    await until(async () => received.length > 0, 'member receives');
    expect(Object.keys(received[0]).sort()).toEqual(['conversation_id', 'message_id']);
    expect(received[0].message_id).toBe(sent.id);
    expect(JSON.stringify(received[0])).not.toContain('live text');
    await new Promise((r) => setTimeout(r, 150));
    expect(outsiderReceived).toHaveLength(0);
  });

  it('CHT-20 a removed member stops receiving events at once', async () => {
    const w = await world();
    const cr = await loadRequestUser(w.cr._id);
    const removed = await socketFor(w.s2._id);
    await until(() => inRoom(`conversation:${w.groupA._id}`, w.s2._id), 'joins before removal');
    const received = [];
    removed.on('message.new', (p) => received.push(p));
    await removeMember(cr, String(w.groupA._id), String(w.s2._id));
    await until(async () => !(await inRoom(`conversation:${w.groupA._id}`, w.s2._id)), 'leaves');
    await sendMessage(await loadRequestUser(w.s1._id), w.groupA._id, 'after removal');
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(0);
  });
});
