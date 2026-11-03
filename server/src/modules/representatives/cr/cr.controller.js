import { getCrOverview } from './cr.overview.service.js';
import { getCrRoutine } from './cr.routine.service.js';
import { sendReminder } from './cr.reminders.service.js';
import { raiseFlag } from './cr.flags.service.js';

export const overview = async (r, res) =>
  res.json({ data: await getCrOverview(r.user, r.params.id) });
export const routine = async (r, res) =>
  res.json({ data: await getCrRoutine(r.user, r.params.id) });
export const reminder = async (r, res) =>
  res.status(202).json({ data: await sendReminder(r.user, r.params.id, r.body) });
export const flag = async (r, res) =>
  res.status(201).json({ data: await raiseFlag(r.user, r.params.id, r.body) });
