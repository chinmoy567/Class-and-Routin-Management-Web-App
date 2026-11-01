import * as service from './organisation.service.js';

export async function list(req, res) {
  res.json({ data: await service.listDomains(req.user) });
}

export async function add(req, res) {
  res.status(201).json({ data: await service.addDomain(req.user, req.body.domain) });
}

export async function remove(req, res) {
  await service.removeDomain(req.user, req.params.domain);
  res.status(204).end();
}
