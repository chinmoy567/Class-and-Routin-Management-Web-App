import { Router } from 'express';
import { createSemesterBody, semesterIdParam, updateSemesterBody } from '@crm/shared';
import { validate } from '../../lib/validate.js';
import * as controller from './semester.controller.js';

// Mounted at /api/semesters behind requireAuth (any signed-in account).
export const semestersRouter = Router();
semestersRouter.get('/current', controller.readCurrent);

// Mounted at /api/admin behind requireAuth. The 'semester.*' policies are checked in the service.
export const semestersAdminRouter = Router();
semestersAdminRouter.get('/semesters', controller.list);
semestersAdminRouter.post('/semesters', validate({ body: createSemesterBody }), controller.create);
semestersAdminRouter.patch(
  '/semesters/:id',
  validate({ params: semesterIdParam, body: updateSemesterBody }),
  controller.update,
);
semestersAdminRouter.delete(
  '/semesters/:id',
  validate({ params: semesterIdParam }),
  controller.remove,
);
semestersAdminRouter.post(
  '/semesters/:id/bootstrap-current',
  validate({ params: semesterIdParam }),
  controller.bootstrap,
);
