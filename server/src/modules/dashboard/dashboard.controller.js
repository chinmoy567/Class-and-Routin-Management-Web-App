import { getDashboard } from './dashboard.service.js';
import { getSectionRoster } from './roster.service.js';

export async function dashboard(req, res) {
  res.json({ data: await getDashboard(req.user) });
}

export async function roster(req, res) {
  res.json({ data: await getSectionRoster(req.user, req.params.id) });
}
