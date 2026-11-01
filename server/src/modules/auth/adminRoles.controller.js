import * as service from './adminRoles.service.js';

export async function list(req, res) {
  res.json({ data: await service.listAdmins(req.user) });
}
export async function search(req, res) {
  res.json({ data: await service.searchEligibleUsers(req.user, req.query.q) });
}
export async function grant(req, res) {
  res.status(201).json({ data: await service.grantAdminRole(req.user, req.body) });
}
export async function remove(req, res) {
  await service.removeAdminRole(req.user, req.params.roleId);
  res.status(204).end();
}
export async function resetPassword(req, res) {
  await service.resetAdminPassword(req.user, req.params.userId);
  res.status(202).json({ data: { accepted: true } });
}
export async function resetSecondStep(req, res) {
  await service.resetAdminSecondStep(req.user, req.params.userId);
  res.json({ data: { reset: true } });
}
