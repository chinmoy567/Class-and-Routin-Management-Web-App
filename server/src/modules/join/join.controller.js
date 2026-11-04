import * as req from './request.service.js';
import * as dec from './decision.service.js';
import * as list from './list.service.js';

export const options = async (r, res) => res.json({ data: await req.joinOptions(r.user) });
export const create = async (r, res) =>
  res.status(201).json({ data: await req.createRequest(r.user, r.body) });
export const withdraw = async (r, res) =>
  res.json({ data: await req.withdrawRequest(r.user, r.params.id) });
export const mine = async (r, res) => res.json({ data: await req.myRequest(r.user) });

export const sectionRequests = async (r, res) =>
  res.json({ data: await list.listSectionRequests(r.user, r.params.id) });
export const adminList = async (r, res) =>
  res.json({ data: await list.listForAdmin(r.user, r.query) });

export const decide = async (r, res) =>
  res.json({ data: await dec.decide(r.user, r.params.id, r.body) });
export const group = async (r, res) =>
  res.json({ data: await dec.changeGroup(r.user, r.params.id, r.body) });
export const appeal = async (r, res) => res.json({ data: await dec.appeal(r.user, r.params.id) });
export const appealDecision = async (r, res) =>
  res.json({ data: await dec.decideAppeal(r.user, r.params.id, r.body) });
export const removeFromSection = async (r, res) =>
  res.json({ data: await dec.removeFromSection(r.user, r.params.id, r.body) });
