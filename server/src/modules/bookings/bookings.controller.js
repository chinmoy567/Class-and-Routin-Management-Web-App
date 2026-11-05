import * as svc from './send.service.js';
import * as dec from './decision.service.js';
import * as cancel from './cancel.service.js';
import * as q from './queries.service.js';
import * as opt from './options.service.js';

export const options = async (r, res) =>
  res.json({ data: await opt.requestOptions(r.user, r.query.section_id) });

export const send = async (r, res) =>
  res.status(201).json({ data: await svc.sendRequest(r.user, r.body) });
export const mine = async (r, res) => res.json({ data: await q.myRequests(r.user) });
export const queue = async (r, res) => res.json({ data: await q.adminQueue(r.user, r.query) });
export const decide = async (r, res) =>
  res.json({ data: await dec.decideRequest(r.user, r.params.id, r.body) });
export const cancelRequest = async (r, res) =>
  res.json({ data: await cancel.cancelRequest(r.user, r.params.id, r.body) });
export const noShow = async (r, res) =>
  res.json({ data: await cancel.addNoShowNote(r.user, r.params.id, r.body) });
