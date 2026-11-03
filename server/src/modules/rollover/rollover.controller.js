import * as rollover from './makeCurrent.service.js';
import * as readiness from './readiness.service.js';
import * as update from './semesterUpdate.service.js';

export const readinessView = async (r, res) =>
  res.json({ data: await readiness.readinessFor(r.user, r.params.id) });
export const makeCurrent = async (r, res) =>
  res.json({ data: await rollover.makeCurrent(r.user, r.params.id, r.body) });
export const semesterUpdate = async (r, res) =>
  res.json({ data: await update.semesterUpdate(r.user) });
export const graduate = async (r, res) => res.json({ data: await update.graduate(r.user) });
export const notEnrolled = async (r, res) => res.json({ data: await update.notEnrolled(r.user) });
