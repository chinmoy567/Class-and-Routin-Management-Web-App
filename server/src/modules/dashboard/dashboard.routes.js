import { Router } from 'express';
import { sectionIdParam } from '@crm/shared';
import { requireAuth } from '../auth/index.js';
import { validate } from '../../lib/validate.js';
import * as c from './dashboard.controller.js';

// Mounted at /api. DSH-01: one call for the whole dashboard.
export const dashboardRouter = Router();
dashboardRouter.get('/me/dashboard', requireAuth, c.dashboard);

// Mounted at /api. DSH-13: one section's roster.
export const rosterRouter = Router();
rosterRouter.get(
  '/sections/:id/roster',
  requireAuth,
  validate({ params: sectionIdParam }),
  c.roster,
);
