import { assignRole } from './assign.service.js';
import { removeRole } from './remove.service.js';
import { reappoint } from './reappoint.service.js';
import { representativesOfSection, searchStudents, summary } from './query.service.js';

export const view = async (req, res) =>
  res.json({ data: await representativesOfSection(req.user, req.params.id) });
export const assign = async (req, res) =>
  res.status(201).json({
    data: await assignRole(req.user, {
      sectionId: req.params.id,
      userId: req.body.user_id,
      role: req.body.role,
    }),
  });
export const reappointAll = async (req, res) =>
  res.json({ data: await reappoint(req.user, req.params.id) });
export const remove = async (req, res) => {
  await removeRole(req.user, req.params.roleId);
  res.status(204).end();
};
export const search = async (req, res) =>
  res.json({ data: await searchStudents(req.user, req.query) });
export const summaryOf = async (req, res) =>
  res.json({ data: await summary(req.user, req.params.id, req.query.department_id) });
