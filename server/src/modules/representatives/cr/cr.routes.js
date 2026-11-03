import { Router } from 'express';
import { flagBody, reminderBody, sectionIdParam } from '@crm/shared';
import { requireAuth } from '../../auth/index.js';
import { validate } from '../../../lib/validate.js';
import * as c from './cr.controller.js';

// Mounted at /api. Every route needs a session; the 'cr.*' policies run in the services, so a
// CR/DCR of another section, or anyone else, gets 404 (CRD-DSH-01, CRD-DSH-02).
export const crRouter = Router();
crRouter.get(
  '/cr/sections/:id/overview',
  requireAuth,
  validate({ params: sectionIdParam }),
  c.overview,
);
crRouter.get(
  '/cr/sections/:id/routine',
  requireAuth,
  validate({ params: sectionIdParam }),
  c.routine,
);
crRouter.post(
  '/cr/sections/:id/reminders',
  requireAuth,
  validate({ params: sectionIdParam, body: reminderBody }),
  c.reminder,
);
crRouter.post(
  '/cr/sections/:id/flags',
  requireAuth,
  validate({ params: sectionIdParam, body: flagBody }),
  c.flag,
);
