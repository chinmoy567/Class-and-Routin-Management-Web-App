import * as students from './students.service.js';
import { auditLog } from './audit.service.js';
import { getAdminDashboard } from './dashboard.service.js';
import { listFlagsForAdmin, resolveFlag } from '../representatives/index.js';

export const searchStudents = async (r, res) =>
  res.json({ data: await students.searchStudents(r.user, r.query) });
export const deactivate = async (r, res) =>
  res.json({ data: await students.deactivateStudent(r.user, r.params.id, r.body) });
export const reactivate = async (r, res) =>
  res.json({ data: await students.reactivateStudent(r.user, r.params.id) });
export const graduate = async (r, res) =>
  res.json({ data: await students.graduateStudent(r.user, r.params.id) });
export const ungraduate = async (r, res) =>
  res.json({ data: await students.ungraduateStudent(r.user, r.params.id) });
// ADM-15: the password is in the body of this one response only, and must never be cached.
export const tempPassword = async (r, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await students.issueTempPassword(r.user, r.params.id) });
};

export const flags = async (r, res) => res.json({ data: await listFlagsForAdmin(r.user, r.query) });
export const resolve = async (r, res) =>
  res.json({ data: await resolveFlag(r.user, r.params.id, r.body) });

export const audit = async (r, res) => res.json({ data: await auditLog(r.user, r.query) });

export const dashboard = async (r, res) =>
  res.json({ data: await getAdminDashboard(r.user, r.query) });
