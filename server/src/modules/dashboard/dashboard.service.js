// DSH-01 to DSH-16: one summary for the signed-in student or teacher. Each card's data is built
// only when its release is live (DSH-02), so an unreleased card is never computed.
import { CURRENT_RELEASE, isReleased } from '@crm/shared';
import { assertCan, stateIn } from '../../policy/index.js';
import { AppError } from '../../lib/errors.js';
import { currentSemester } from '../organisation/index.js';
import { upcomingEvents } from '../calendar/index.js';
import { freeNow } from '../rooms/index.js';
import { buildRegisteredCards } from './cards.js';
import { studentView } from './student.card.js';
import { teacherAccount, teacherSections } from './teacher.card.js';
import { contactReminders } from './reminders.js';

const FREE_ROOMS_SHOWN = 20;

/** DSH-08, DSH-14: the rooms free right now, view only. Only the free ones are listed. */
async function freeNowFor(actor) {
  const data = await freeNow(actor);
  const free = data.rooms.filter((r) => r.status === 'free');
  return {
    free_count: free.length,
    from: data.from,
    to: data.to,
    rooms: free.slice(0, FREE_ROOMS_SHOWN).map((r) => ({ id: r.id, code: r.code, type: r.type })),
  };
}

async function studentPart(actor, semester, release, out) {
  const sectionOn = isReleased('dashboard.student.section', release);
  const reminderOn = isReleased('dashboard.student.reminders', release);
  if (!sectionOn && !reminderOn) return;
  const view = await studentView(actor, semester);
  if (sectionOn) {
    out.section = view.section;
    out.representatives = view.representatives;
    out.courses = view.courses;
  }
  if (reminderOn) {
    out.reminders = {
      ...(await contactReminders(actor._id)),
      group_missing: view.group_missing,
      semester_badge: semester ? { semester: semester.name, confirmed: view.enrolled } : null,
    };
  }
}

async function teacherPart(actor, semester, release, out) {
  if (isReleased('dashboard.teacher.account', release)) {
    out.teacher_link = await teacherAccount(actor);
    out.reminders = await contactReminders(actor._id);
  }
  if (isReleased('dashboard.teacher.students', release) && semester) {
    out.sections_taught = await teacherSections(actor, semester);
  }
}

/** DSH-01: the whole dashboard for the signed-in person, in one response. */
export async function getDashboard(actor, { release = CURRENT_RELEASE } = {}) {
  if (!stateIn(actor, 'active')) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot view its dashboard yet.', {
      state: actor.state,
    });
  }
  assertCan(actor, 'dashboard.read');

  const p = `dashboard.${actor.kind}`;
  const semester = await currentSemester();
  const out = {
    kind: actor.kind,
    semester: semester
      ? {
          id: semester.id,
          name: semester.name,
          start_date: semester.start_date,
          end_date: semester.end_date,
        }
      : null,
  };

  // DSH-07, DSH-15: the next 14 days of calendar events.
  if (isReleased(`${p}.notices`, release)) out.upcoming_events = await upcomingEvents(actor);
  // DSH-08, DSH-14: the rooms free right now.
  if (isReleased(`${p}.rooms`, release)) out.free_now = await freeNowFor(actor);

  if (actor.kind === 'student') await studentPart(actor, semester, release, out);
  else await teacherPart(actor, semester, release, out);

  Object.assign(out, await buildRegisteredCards(actor, release));
  return out;
}
