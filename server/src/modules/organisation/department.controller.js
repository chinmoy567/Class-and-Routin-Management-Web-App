import * as service from './department.service.js';

export async function listPublic(_req, res) {
  res.json({ data: await service.listActiveDepartments() });
}
export async function listAdmin(req, res) {
  res.json({ data: await service.listAllDepartments(req.user) });
}
export async function create(req, res) {
  res.status(201).json({ data: await service.createDepartment(req.user, req.body) });
}
export async function update(req, res) {
  res.json({ data: await service.updateDepartment(req.user, req.params.id, req.body) });
}
export async function retire(req, res) {
  res.json({ data: await service.retireDepartment(req.user, req.params.id) });
}
