import * as service from './rooms.service.js';

export async function listActive(req, res) {
  res.json({ data: await service.listActiveRooms(req.user) });
}
export async function listAdmin(req, res) {
  res.json({ data: await service.listAdminRooms(req.user, req.query.department_id) });
}
export async function create(req, res) {
  res.status(201).json({ data: await service.createRoom(req.user, req.body) });
}
export async function update(req, res) {
  res.json({ data: await service.updateRoom(req.user, req.params.id, req.body) });
}
export async function addAlias(req, res) {
  res.status(201).json({ data: await service.addAlias(req.user, req.params.id, req.body) });
}
export async function removeAlias(req, res) {
  await service.removeAlias(req.user, req.params.id, req.params.aliasId);
  res.status(204).end();
}
export async function setShares(req, res) {
  res.json({ data: await service.setShares(req.user, req.params.id, req.body.department_ids) });
}
export async function retire(req, res) {
  res.json({ data: await service.retireRoom(req.user, req.params.id) });
}
