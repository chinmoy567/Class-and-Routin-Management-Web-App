// Spec 21: chat files. One test per acceptance criterion (FIL-01 … FIL-11), the EICAR case, the
// scanner-down case and cross-scope refusals for every role.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  drainFileScans,
  fixClock,
  loginAs,
  resetClock,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import * as f from '../../../../test/fileFixtures.js';
import { getConfig } from '../../../config.js';
import { Semester } from '../../organisation/index.js';
import { Section } from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { setScanner } from '../../../lib/clamav.js';
import { Conversation, ConversationMember, Message } from '../chat.model.js';
import { onRepAssigned, onRollover } from '../chat.group.service.js';
import { FILE_MAX_BYTES } from '../chat.files.service.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  await startTestMail();
  app = buildTestApp();
});
afterAll(async () => {
  await stopTestMail();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  setScanner(eicarScanner);
});
afterEach(() => {
  setScanner();
  resetClock();
});

/** The stand-in for ClamAV: it flags the EICAR test string and passes everything else. */
const eicarScanner = async (buffer) => ({
  infected: buffer.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'),
});

const MB = 1024 * 1024;
const BOUNDARY = 'chatfilesboundary';

/** A multipart body with an optional caption and the file part. */
function multipart({ file, filename, caption }) {
  const parts = [];
  if (caption !== undefined) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    file,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  );
  return Buffer.concat(parts);
}

const upload = (agent, convId, { file, filename = 'notes.pdf', caption }) =>
  agent
    .post(`/api/chat/conversations/${convId}/files`)
    .set('Content-Type', `multipart/form-data; boundary=${BOUNDARY}`)
    .send(multipart({ file, filename, caption }));

const getLink = (agent, fileId) => agent.post(`/api/chat/files/${fileId}/link`);
const fileDocs = () => mongoose.connection.db.collection('chat_files.files').find({}).toArray();
const openDirect = (agent, other) =>
  agent.post('/api/chat/direct').send({ user_id: String(other._id) });
const groupOf = (sec) =>
  Conversation.findOne({ type: 'section_group', section_id: sec._id }).lean();

/** The signed link a user would hold, built the way the server builds it (for forging tests). */
function forgedLink(fileId, user, expSeconds, sig) {
  return `/api/chat/files/${fileId}/download?u=${user}&exp=${expSeconds}&sig=${sig}`;
}

/** CSE 2-II-A (CR, DCR, two students, a claim_pending applicant), CSE 2-II-B, and other roles. */
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
  const enrol = async (u, sec, status = 'accepted') => {
    await Enrolment.create({
      user_id: u._id,
      semester_id: sem._id,
      section_id: sec._id,
      department_id: cse._id,
      status,
    });
    return u;
  };
  const rep = (role, sec) =>
    makeUser({
      kind: 'student',
      state: 'active',
      name: `${role.toUpperCase()} ${sec.letter}`,
      roles: [
        {
          role,
          department_id: cse._id,
          section_id: sec._id,
          semester_id: sem._id,
          is_representative: true,
        },
      ],
    });
  const accepted = async (sec, name, state = 'active') =>
    enrol(await makeUser({ kind: 'student', state, name, departmentId: cse._id }), sec);

  const w = {
    cse,
    sem,
    secA,
    secB,
    cr: await rep('cr', secA),
    dcr: await rep('dcr', secA),
    crB: await rep('cr', secB),
    studentA: await accepted(secA, 'Rahim Ahmed'),
    studentA2: await accepted(secA, 'Karim Hossain'),
    studentB: await accepted(secB, 'Sumi Begum'),
    unconfirmed: await makeUser({ kind: 'student', state: 'unconfirmed', name: 'Unconfirmed U' }),
    graduated: await makeUser({ kind: 'student', state: 'graduated', name: 'Grad G' }),
    claimPending: await enrol(
      await makeUser({ kind: 'student', state: 'claim_pending', name: 'Claimer C' }),
      secA,
      'pending',
    ),
    teacher: await makeUser({
      kind: 'teacher',
      state: 'active',
      name: 'Teacher T',
      departmentId: cse._id,
    }),
    cseAdmin: await makeUser({
      kind: 'staff',
      state: 'active',
      name: 'CSE Admin',
      roles: [{ role: 'dept_admin', department_id: cse._id }],
    }),
    superAdmin: await makeUser({
      kind: 'staff',
      state: 'active',
      name: 'Super',
      roles: [{ role: 'super_admin' }],
    }),
  };
  // Groups are created when the CR takes effect; accepted students are added then.
  await onRepAssigned({ id: String(secA._id) });
  await onRepAssigned({ id: String(secB._id) });
  return w;
}

/** A direct chat between two people, opened by `a`. Returns the conversation id. */
async function directBetween(app, a, b) {
  const agent = await loginAs(a, app);
  return (await openDirect(agent, b)).body.data.id;
}

describe('FIL-01: the type comes from the content', () => {
  it('FIL-01 a PDF renamed to .jpg is stored as a PDF', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const agent = await loginAs(w.studentA, app);
    const res = await upload(agent, conv, { file: f.PDF, filename: 'photo.jpg' });
    expect(res.status).toBe(201);
    const [doc] = await fileDocs();
    expect(doc.metadata.detected_type).toBe('application/pdf');
  });

  it('FIL-01 an .exe renamed to .pdf → FILE_TYPE_NOT_ALLOWED, nothing stored', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const agent = await loginAs(w.studentA, app);
    const res = await upload(agent, conv, { file: f.EXE, filename: 'setup.pdf' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await fileDocs()).toHaveLength(0);
  });
});

describe('FIL-02: SVG and macro-enabled Office files are always refused', () => {
  it('FIL-02 an SVG → FILE_TYPE_NOT_ALLOWED', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const res = await upload(await loginAs(w.studentA, app), conv, {
      file: f.SVG,
      filename: 'diagram.svg',
    });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('FIL-02 a .docm renamed to .docx → FILE_TYPE_NOT_ALLOWED', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const res = await upload(await loginAs(w.studentA, app), conv, {
      file: f.DOCM,
      filename: 'essay.docx',
    });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await fileDocs()).toHaveLength(0);
  });
});

describe('FIL-03: maximum 5 MB, enforced while streaming', () => {
  const sized = (bytes) => Buffer.concat([f.PDF, Buffer.alloc(bytes - f.PDF.length, 0x20)]);

  it('FIL-03 a 5.1 MB file → FILE_TOO_LARGE, and nothing is stored', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const res = await upload(await loginAs(w.studentA, app), conv, {
      file: sized(Math.floor(5.1 * MB)),
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(await fileDocs()).toHaveLength(0);
  });

  it('FIL-03 exactly 5 MB is accepted', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const res = await upload(await loginAs(w.studentA, app), conv, {
      file: sized(FILE_MAX_BYTES),
    });
    expect(res.status).toBe(201);
  });

  it('FIL-03 a body far past the limit is cut off while streaming (FILE_TOO_LARGE)', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const res = await upload(await loginAs(w.studentA, app), conv, { file: sized(6 * MB) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(await fileDocs()).toHaveLength(0);
  });
});

describe('FIL-04: who may share', () => {
  it('FIL-04 a claim_pending student uploading → STATE_NOT_ALLOWED', async () => {
    const w = await world();
    const conv = await directBetween(app, w.claimPending, w.cr);
    const res = await upload(await loginAs(w.claimPending, app), conv, { file: f.PDF });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('FIL-04 a graduated student uploading → STATE_NOT_ALLOWED', async () => {
    const w = await world();
    const conv = await directBetween(app, w.graduated, w.studentA);
    const res = await upload(await loginAs(w.graduated, app), conv, { file: f.PDF });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('FIL-04 an unconfirmed student may not upload in a section group', async () => {
    const w = await world();
    // Unconfirmed student is in the group only through a join, so put them in as a member.
    const group = await groupOf(w.secA);
    await ConversationMember.create({ conversation_id: group._id, user_id: w.unconfirmed._id });
    const res = await upload(await loginAs(w.unconfirmed, app), group._id, { file: f.PDF });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('FIL-04 an unconfirmed student may share in a one-to-one chat', async () => {
    const w = await world();
    const conv = await directBetween(app, w.unconfirmed, w.studentA);
    const res = await upload(await loginAs(w.unconfirmed, app), conv, { file: f.PDF });
    expect(res.status).toBe(201);
  });

  it('FIL-04 an active teacher may share one-to-one, a group member may share in the group', async () => {
    const w = await world();
    const conv = await directBetween(app, w.teacher, w.studentA);
    expect(
      (await upload(await loginAs(w.teacher, app), conv, { file: f.TXT, filename: 'a.txt' }))
        .status,
    ).toBe(201);
    const group = await groupOf(w.secA);
    expect(
      (await upload(await loginAs(w.studentA, app), group._id, { file: f.PNG, filename: 'p.png' }))
        .status,
    ).toBe(201);
  });

  it('FIL-04 a file sent to a closed group → GROUP_CLOSED (history stays readable)', async () => {
    const w = await world();
    const group = await groupOf(w.secA);
    await onRollover({ archived_semester_id: String(w.sem._id) });
    const res = await upload(await loginAs(w.studentA, app), group._id, { file: f.PDF });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GROUP_CLOSED');
  });
});

describe('FIL-05: scanning before anyone can download', () => {
  it('FIL-05 the sender and recipient see "scanning" until the scan finishes; the link is FILE_NOT_READY', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.PDF, caption: 'Week 4 slides' });
    expect(res.status).toBe(201);
    expect(res.body.data.file).toMatchObject({ name: 'notes.pdf', status: 'scanning' });
    expect(res.body.data.body).toBe('Week 4 slides');
    const fileId = res.body.data.file.id;

    const recipient = await loginAs(w.studentA2, app);
    const list = await recipient.get(`/api/chat/conversations/${conv}/messages`);
    expect(list.body.data[0].file.status).toBe('scanning');

    const early = await getLink(recipient, fileId);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('FILE_NOT_READY');
  });

  it('FIL-05 a forged link is refused until the scan is clean', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const res = await upload(await loginAs(w.studentA, app), conv, { file: f.PDF });
    const fileId = res.body.data.file.id;
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = signFor(fileId, w.studentA2._id, exp);
    const forged = forgedLink(fileId, String(w.studentA2._id), exp, sig);
    const dl = await (await loginAs(w.studentA2, app)).get(forged);
    expect(dl.status).toBe(404);
  });
});

/** The HMAC the server makes, with the configured key (for the forging tests). */
function signFor(fileId, userId, exp) {
  return crypto
    .createHmac('sha256', getConfig().FILE_LINK_KEY)
    .update(`${fileId}:${userId}:${exp}`)
    .digest('hex');
}

describe('FIL-06: ClamAV scan', () => {
  it('FIL-06 the EICAR test file is marked infected, its bytes are gone, the message says removed', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.EICAR, filename: 'eicar.txt' });
    expect(res.status).toBe(201);
    await drainFileScans();

    expect(await fileDocs()).toHaveLength(0);
    const list = await sender.get(`/api/chat/conversations/${conv}/messages`);
    expect(list.body.data[0].file).toMatchObject({ status: 'removed', name: null });
    const fileId = res.body.data.file.id;
    expect((await getLink(sender, fileId)).status).toBe(404);
  });

  it('FIL-06 a clean file becomes downloadable after the scan', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.TXT, filename: 'lecture.txt' });
    await drainFileScans();
    const link = await getLink(sender, res.body.data.file.id);
    expect(link.status).toBe(200);
    expect(link.body.data.url).toMatch(/\/download\?u=/);
    const list = await sender.get(`/api/chat/conversations/${conv}/messages`);
    expect(list.body.data[0].file.status).toBe('ready');
  });

  it('FIL-06 an unreachable scanner leaves the file pending; a later scan can still clear it', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.PDF });
    setScanner(async () => {
      throw new Error('clamd unreachable');
    });
    await expect(drainFileScans()).rejects.toThrow('clamd unreachable');
    expect((await getLink(sender, res.body.data.file.id)).body.error.code).toBe('FILE_NOT_READY');

    setScanner(eicarScanner);
    await drainFileScans();
    expect((await getLink(sender, res.body.data.file.id)).status).toBe(200);
  });
});

describe('FIL-07, FIL-08: signed links and download', () => {
  it('FIL-08 a link is valid for 5 minutes, and the response is an attachment, never inline', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.PDF, filename: 'slides.pdf' });
    await drainFileScans();
    const link = await getLink(sender, res.body.data.file.id);
    const sent = await sender.get(link.body.data.url);
    expect(sent.status).toBe(200);
    expect(sent.headers['content-disposition']).toMatch(/^attachment;/);
    expect(sent.headers['content-disposition']).toContain('slides.pdf');
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(sent.headers['content-type']).toBe('application/pdf');
  });

  it('FIL-08 a link used after 5 minutes → LINK_EXPIRED', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.PDF });
    await drainFileScans();
    const link = await getLink(sender, res.body.data.file.id);
    fixClock(new Date(Date.now() + 301_000));
    const late = await sender.get(link.body.data.url);
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('LINK_EXPIRED');
  });

  it('FIL-08 a link made for user A used by user B → NOT_FOUND', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.PDF });
    await drainFileScans();
    const link = await getLink(sender, res.body.data.file.id);
    const other = await loginAs(w.studentA2, app);
    const stolen = await other.get(link.body.data.url);
    expect(stolen.status).toBe(404);
    expect(stolen.body.error.code).toBe('NOT_FOUND');
  });

  it('FIL-08 a link with a changed signature or expiry → NOT_FOUND', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.PDF });
    await drainFileScans();
    const link = await getLink(sender, res.body.data.file.id);
    const url = new URL(link.body.data.url, 'http://x');
    const tampered = `${url.pathname}?u=${url.searchParams.get('u')}&exp=${Number(url.searchParams.get('exp')) + 600}&sig=${url.searchParams.get('sig')}`;
    expect((await sender.get(tampered)).status).toBe(404);
    const wrongSig = `${url.pathname}?u=${url.searchParams.get('u')}&exp=${url.searchParams.get('exp')}&sig=${'0'.repeat(64)}`;
    expect((await sender.get(wrongSig)).status).toBe(404);
  });

  it('FIL-07 a member removed from a group cannot get a link or download (404)', async () => {
    const w = await world();
    const group = await groupOf(w.secA);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, group._id, { file: f.PDF });
    await drainFileScans();
    const fileId = res.body.data.file.id;
    const removedAgent = await loginAs(w.studentA2, app);
    const earlier = await getLink(removedAgent, fileId);
    expect(earlier.status).toBe(200);

    const owner = await loginAs(w.cr, app);
    const removed = await owner.delete(
      `/api/chat/conversations/${group._id}/members/${w.studentA2._id}`,
    );
    expect(removed.status).toBe(204);

    expect((await getLink(removedAgent, fileId)).status).toBe(404);
    expect((await removedAgent.get(earlier.body.data.url)).status).toBe(404);
  });

  it('FIL-07 members can still download a file from a closed group (history)', async () => {
    const w = await world();
    const group = await groupOf(w.secA);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, group._id, { file: f.PDF });
    await drainFileScans();
    await onRollover({ archived_semester_id: String(w.sem._id) });
    const link = await getLink(sender, res.body.data.file.id);
    expect(link.status).toBe(200);
    expect((await sender.get(link.body.data.url)).status).toBe(200);
  });
});

describe('FIL-09: names', () => {
  it('FIL-09 a path-laden name is stored without path characters, at most 120 characters', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const name = `../../../secret<1>${'y'.repeat(200)}.pdf`;
    const res = await upload(await loginAs(w.studentA, app), conv, { file: f.PDF, filename: name });
    expect(res.status).toBe(201);
    const [doc] = await fileDocs();
    expect(doc.metadata.original_name).not.toMatch(/[/\\<>]/);
    expect(doc.metadata.original_name.length).toBeLessThanOrEqual(120);
    expect(doc.metadata.original_name.endsWith('.pdf')).toBe(true);
  });
});

describe('FIL-10: 20 uploads per hour', () => {
  it('FIL-10 the 21st upload within an hour → RATE_LIMITED', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    for (let i = 0; i < 20; i++) {
      expect((await upload(sender, conv, { file: f.PDF, filename: `n${i}.pdf` })).status).toBe(201);
    }
    const res = await upload(sender, conv, { file: f.PDF, filename: 'one-more.pdf' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('FIL-10 concurrent uploads cannot get past 20 in an hour (25 sent at once → at most 20 stored)', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        upload(sender, conv, { file: f.PDF, filename: `c${i}.pdf` }),
      ),
    );
    const accepted = results.filter((r) => r.status === 201).length;
    expect(accepted).toBeLessThanOrEqual(20);
    expect(results.filter((r) => r.status === 429).length).toBe(25 - accepted);
    expect(await fileDocs()).toHaveLength(accepted);
  });

  it('FIL-10 the hour is rolling: 20 uploads at t0, refused at +30 min, allowed again after +1 h', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const t0 = Date.now();
    fixClock(new Date(t0));
    for (let i = 0; i < 20; i++) {
      expect((await upload(sender, conv, { file: f.PDF, filename: `r${i}.pdf` })).status).toBe(201);
    }
    fixClock(new Date(t0 + 30 * 60 * 1000));
    const refused = await upload(sender, conv, { file: f.PDF, filename: 'mid.pdf' });
    expect(refused.status).toBe(429);
    // Retry-After points at the moment the oldest of the 20 leaves the hour (about 30 minutes).
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(1700);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(1800);
    fixClock(new Date(t0 + 60 * 60 * 1000 + 1000));
    expect((await upload(sender, conv, { file: f.PDF, filename: 'later.pdf' })).status).toBe(201);
  });

  it('FIL-10 an upload refused for its type does not use one of the 20', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    for (let i = 0; i < 20; i++) {
      expect((await upload(sender, conv, { file: f.EXE, filename: `bad${i}.pdf` })).status).toBe(
        415,
      );
    }
    for (let i = 0; i < 20; i++) {
      expect((await upload(sender, conv, { file: f.PDF, filename: `ok${i}.pdf` })).status).toBe(
        201,
      );
    }
    expect((await upload(sender, conv, { file: f.PDF })).status).toBe(429);
  });
});

describe('FIL-11: deleting the message removes the file from view', () => {
  it('FIL-11 the sender deletes the message → the file is gone for everyone, download → NOT_FOUND', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.PDF });
    await drainFileScans();
    const link = await getLink(sender, res.body.data.file.id);
    expect((await sender.delete(`/api/chat/messages/${res.body.data.id}`)).status).toBe(204);
    const recipient = await loginAs(w.studentA2, app);
    const list = await recipient.get(`/api/chat/conversations/${conv}/messages`);
    expect(list.body.data[0]).toMatchObject({ deleted: true, file: null });
    expect((await sender.get(link.body.data.url)).status).toBe(404);
    expect(
      await Message.countDocuments({ _id: res.body.data.id, body_enc: { $exists: true } }),
    ).toBe(0);
  });

  it("FIL-11 a group owner deletes a member's file message → it is gone", async () => {
    const w = await world();
    const group = await groupOf(w.secA);
    const res = await upload(await loginAs(w.studentA, app), group._id, { file: f.PDF });
    await drainFileScans();
    const owner = await loginAs(w.cr, app);
    expect((await owner.delete(`/api/chat/messages/${res.body.data.id}`)).status).toBe(204);
    const link = await getLink(await loginAs(w.studentA, app), res.body.data.file.id);
    expect(link.status).toBe(404);
  });
});

describe('cross-scope: only current members get links or downloads', () => {
  it('every outsider gets 404 for a file in another pair and for another group', async () => {
    const w = await world();
    const conv = await directBetween(app, w.studentA, w.studentA2);
    const sender = await loginAs(w.studentA, app);
    const res = await upload(sender, conv, { file: f.PDF });
    await drainFileScans();
    const fileId = res.body.data.file.id;
    const outsiders = [
      w.claimPending,
      w.teacher,
      w.cr,
      w.dcr,
      w.studentB,
      w.cseAdmin,
      w.superAdmin,
      w.unconfirmed,
    ];
    for (const u of outsiders) {
      const agent = await loginAs(u, app);
      expect((await getLink(agent, fileId)).status).toBe(404);
      const exp = Math.floor(Date.now() / 1000) + 300;
      const sig = signFor(fileId, u._id, exp);
      expect((await agent.get(forgedLink(fileId, String(u._id), exp, sig))).status).toBe(404);
      // A non-member cannot even reach the upload rules: 404, as for every other chat read.
      expect((await agent.post(`/api/chat/conversations/${conv}/files`).send({})).status).toBe(404);
    }
  });

  it('cross-scope: a CR of another section cannot upload into this section group', async () => {
    const w = await world();
    const group = await groupOf(w.secA);
    const res = await upload(await loginAs(w.crB, app), group._id, { file: f.PDF });
    expect(res.status).toBe(404);
  });
});
