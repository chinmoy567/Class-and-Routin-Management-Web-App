import { Router } from 'express';
import { makeCurrentBody, semesterIdParam } from '@crm/shared';
import { validate } from '../../lib/validate.js';
import { requireAuth } from '../auth/index.js';
import * as c from './rollover.controller.js';

// Mounted at /api/admin behind requireAuth. The 'rollover.*' policies run in the services.
export const rolloverAdminRouter = Router();
rolloverAdminRouter.get(
  '/semesters/:id/readiness',
  validate({ params: semesterIdParam }),
  c.readinessView,
);
rolloverAdminRouter.post(
  '/semesters/:id/make-current',
  validate({ params: semesterIdParam, body: makeCurrentBody }),
  c.makeCurrent,
);

// Mounted at /api/me. Each route needs a session; the 'semester_update.use' policy runs in the services.
export const rolloverMeRouter = Router();
rolloverMeRouter.get('/semester-update', requireAuth, c.semesterUpdate);
rolloverMeRouter.post('/graduate', requireAuth, c.graduate);
rolloverMeRouter.post('/not-enrolled', requireAuth, c.notEnrolled);
