import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  clearDb,
  connectTestDb,
  disconnectTestDb,
  fixClock,
  resetClock,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { makeUser } from '../../../../test/factories.js';
import { User } from '../../auth/index.js';
import { Semester } from '../../organisation/index.js';
import { getAgenda } from '../../../lib/jobs.js';
import { listOverdueUnconfirmed } from '../overdue.service.js';
import { daysSince, sendDueReminders, sendMilestoneReminders } from '../reminders.service.js';

beforeAll(async () => {
  await connectTestDb();
  await startTestMail();
});
afterAll(async () => {
  await stopTestMail();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
});
afterEach(() => resetClock());

/** Fall 2026 became current on 1 July 2026 (Dhaka). Two unconfirmed students and one not enrolled. */
async function world() {
  const current = await Semester.create({
    name: 'Fall 2026',
    status: 'current',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
    made_current_at: new Date('2026-07-01T00:00:00Z'),
  });
  const a = await makeUser({ kind: 'student', state: 'unconfirmed', name: 'Asha' });
  const b = await makeUser({ kind: 'student', state: 'unconfirmed', name: 'Bilal' });
  const notEnrolled = await makeUser({ kind: 'student', state: 'unconfirmed', name: 'Chandan' });
  await User.updateOne(
    { _id: notEnrolled._id },
    { $set: { not_enrolled_semester_id: current._id } },
  );
  return { current, a, b, notEnrolled };
}

/** The reminder jobs queued so far (kept in the queue, as production keeps them). */
const reminderJobs = async () =>
  getAgenda().jobs({ name: 'email.send', 'data.template': 'semester_update_reminder' });

describe('semester update reminders (ROL-13)', () => {
  it('ROL-13 day 0 sends one reminder to each unconfirmed student, not to the not-enrolled', async () => {
    const w = await world();
    await sendMilestoneReminders(String(w.current._id), 0);
    const jobs = await reminderJobs();
    const to = jobs.map((j) => j.attrs.data.to_user_id).sort();
    expect(to).toEqual([String(w.a._id), String(w.b._id)].sort());
  });

  it('ROL-13 day 7 is due on the seventh day, and sending it twice does not duplicate', async () => {
    const w = await world();
    fixClock('2026-07-08T04:00:00Z'); // 10:00 on 8 July, Dhaka
    expect(await sendDueReminders()).toBe(2);
    const first = (await reminderJobs()).length;
    await sendDueReminders();
    expect((await reminderJobs()).length).toBe(first);
    expect(first).toBe(2);
    expect(w.notEnrolled).toBeTruthy();
  });

  it('ROL-13 nothing is due on day 3, and day 14 is due again', async () => {
    await world();
    fixClock('2026-07-04T04:00:00Z');
    expect(await sendDueReminders()).toBe(0);
    fixClock('2026-07-15T04:00:00Z');
    expect(await sendDueReminders()).toBe(2);
  });

  it('ROL-10 a not-enrolled student gets no day-7 reminder', async () => {
    const w = await world();
    fixClock('2026-07-08T04:00:00Z');
    await sendDueReminders();
    const to = (await reminderJobs()).map((j) => j.attrs.data.to_user_id);
    expect(to).not.toContain(String(w.notEnrolled._id));
  });

  it('daysSince counts calendar days in institution time', () => {
    expect(daysSince(new Date('2026-07-01T00:00:00Z'), new Date('2026-07-08T04:00:00Z'))).toBe(7);
    expect(daysSince(new Date('2026-07-01T00:00:00Z'), new Date('2026-07-01T04:00:00Z'))).toBe(0);
  });
});

describe('the 14-day unconfirmed list (ROL-12)', () => {
  it('ROL-12 nobody is on the list before day 14', async () => {
    await world();
    expect(await listOverdueUnconfirmed(new Date('2026-07-14T04:00:00Z'))).toEqual([]);
  });

  it('ROL-12 on day 14 the unconfirmed students are listed, except the not-enrolled', async () => {
    const w = await world();
    const list = await listOverdueUnconfirmed(new Date('2026-07-15T04:00:00Z'));
    expect([...list].sort()).toEqual([String(w.a._id), String(w.b._id)].sort());
    expect(list).not.toContain(String(w.notEnrolled._id));
  });

  it('ROL-12 an active student is never on the list', async () => {
    await world();
    const active = await makeUser({ kind: 'student', state: 'active' });
    const list = await listOverdueUnconfirmed(new Date('2026-07-20T04:00:00Z'));
    expect(list).not.toContain(String(active._id));
  });
});
