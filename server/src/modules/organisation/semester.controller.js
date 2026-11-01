import * as service from './semester.service.js';

export async function readCurrent(_req, res) {
  res.json({ data: await service.readCurrentSemester() });
}
export async function list(req, res) {
  res.json({ data: await service.listSemesters(req.user) });
}
export async function create(req, res) {
  res.status(201).json({ data: await service.createSemester(req.user, req.body) });
}
export async function update(req, res) {
  res.json({ data: await service.updateSemester(req.user, req.params.id, req.body) });
}
export async function remove(req, res) {
  await service.deleteSemester(req.user, req.params.id);
  res.status(204).end();
}
export async function bootstrap(req, res) {
  res.json({ data: await service.bootstrapCurrent(req.user, req.params.id) });
}
