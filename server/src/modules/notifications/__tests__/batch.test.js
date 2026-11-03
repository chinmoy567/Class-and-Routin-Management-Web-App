import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectTestDb,
  disconnectTestDb,
  startTestMail,
  stopTestMail,
  drainMail,
  clearDb,
  clearOutbox,
  fixClock,
  resetClock,
} from '../../../../test/harness.js';
import { makeUser } from '../../../../test/factories.js';
import { getAgenda } from '../../../lib/jobs.js';
import { clock } from '../../../lib/time.js';
import { addToBatch, flushBatch, FLUSH_JOB } from '../index.js';
import { EmailBatch } from '../email.model.js';

const HOUR = 3600 * 1000;
// drainMail returns the whole outbox, so each check starts from an empty one.
const routineMail = async () => {
  const mails = (await drainMail()).filter((m) => m.subject.includes('routine'));
  clearOutbox();
  return mails;
};

beforeAll(async () => {
  await connectTestDb();
  await startTestMail();
});
beforeEach(async () => {
  await clearDb();
  clearOutbox();
  resetClock();
});
afterAll(async () => {
  resetClock();
  await stopTestMail();
  await disconnectTestDb();
});

describe('routine-change batches (EML-06)', () => {
  it('EML-06 several adds for one person at the same moment leave one batch with every item', async () => {
    const user = await makeUser({ kind: 'student' });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        addToBatch({ userId: user._id, kind: 'routine_changed', item: `item ${i}` }),
      ),
    );
    const batches = await EmailBatch.find({ user_id: user._id }).lean();
    expect(batches).toHaveLength(1);
    expect(batches[0].items).toHaveLength(5);
    const flushes = await getAgenda().jobs({ name: FLUSH_JOB });
    expect(flushes).toHaveLength(1); // only one flush is booked
  });

  it('EML-06 hand edits send one email, an hour after the first edit', async () => {
    const user = await makeUser({ kind: 'student' });
    const start = clock.now();
    for (const item of ['CSE 301 moved', 'CSE 305 added', 'CSE 301 cancelled']) {
      await addToBatch({
        userId: user._id,
        kind: 'routine_changed',
        item,
        semesterName: 'Fall 2026',
      });
    }
    expect(await routineMail()).toHaveLength(0); // not yet

    fixClock(new Date(start.getTime() + HOUR - 60 * 1000));
    expect(await routineMail()).toHaveLength(0); // still not due

    fixClock(new Date(start.getTime() + HOUR + 60 * 1000));
    const mails = await routineMail();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(user.email);
    expect(mails[0].text).toContain('CSE 301 moved');
    expect(mails[0].text).toContain('CSE 301 cancelled');
    expect(mails[0].text).toContain('Fall 2026');
  });

  it('EML-06 a publish (flushNow) sends at once, and the batch is gone afterwards', async () => {
    const user = await makeUser({ kind: 'student' });
    await addToBatch({
      userId: user._id,
      kind: 'routine_changed',
      item: '3-II-A (Sun): CSE 301',
      semesterName: 'Fall 2026',
      flushNow: true,
    });
    expect(await routineMail()).toHaveLength(1);
    expect(await EmailBatch.countDocuments({ user_id: user._id })).toBe(0);
  });

  it('EML-06 a batch is sent once: a second flush finds nothing', async () => {
    const user = await makeUser({ kind: 'student' });
    await addToBatch({ userId: user._id, kind: 'routine_changed', item: 'x', flushNow: false });
    const batch = await EmailBatch.findOne({ user_id: user._id }).lean();
    expect(await flushBatch({ batch_id: batch._id })).toBe(true);
    expect(await flushBatch({ batch_id: batch._id })).toBe(false);
    expect(await drainMail()).toHaveLength(1);
  });

  it('EML-06 a flush booked for an earlier batch never sends a later batch early', async () => {
    const user = await makeUser({ kind: 'student' });
    const t0 = clock.now();
    const at = (min) => new Date(t0.getTime() + min * 60 * 1000);
    fixClock(at(0));
    await addToBatch({ userId: user._id, kind: 'routine_changed', item: 'edit A' }); // flush at 60
    fixClock(at(10));
    await addToBatch({
      userId: user._id,
      kind: 'routine_changed',
      item: 'publish P',
      flushNow: true,
    }); // sends A and P at 10
    expect(await routineMail()).toHaveLength(1);
    fixClock(at(20));
    await addToBatch({ userId: user._id, kind: 'routine_changed', item: 'edit B' }); // flush at 80

    fixClock(at(65)); // the flush booked at 60 for batch A must not send batch B
    expect(await routineMail()).toHaveLength(0);
    fixClock(at(81));
    const later = await routineMail();
    expect(later).toHaveLength(1);
    expect(later[0].text).toContain('edit B');
    expect(later[0].text).not.toContain('edit A');
  });
});
