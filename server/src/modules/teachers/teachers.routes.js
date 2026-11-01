import { Router } from 'express';
import {
  applyAgainBody,
  createTeacherBody,
  decisionBody,
  linkTeacherBody,
  reasonBody,
  registrationIdParam,
  registrationsQuery,
  teacherAccountParam,
  teacherAccountsQuery,
  teacherIdParam,
  teachersQuery,
  updateTeacherBody,
} from '@crm/shared';
import { validate } from '../../lib/validate.js';
import { requireAuth } from '../auth/index.js';
import * as c from './teachers.controller.js';

// Mounted at /api/me
export const teachersMeRouter = Router();
teachersMeRouter.get('/teacher-registration', requireAuth, c.myRegistration);
teachersMeRouter.post(
  '/teacher-registration',
  requireAuth,
  validate({ body: applyAgainBody }),
  c.applyAgain,
);

// Mounted at /api/admin behind requireAuth. The 'teacher.*' policies are checked in the services.
export const teachersAdminRouter = Router();
teachersAdminRouter.get(
  '/teacher-registrations',
  validate({ query: registrationsQuery }),
  c.listRegistrations,
);
teachersAdminRouter.post(
  '/teacher-registrations/:id/decision',
  validate({ params: registrationIdParam, body: decisionBody }),
  c.decide,
);
teachersAdminRouter.get('/teachers', validate({ query: teachersQuery }), c.listTeachers);
teachersAdminRouter.post('/teachers', validate({ body: createTeacherBody }), c.createTeacher);
teachersAdminRouter.patch(
  '/teachers/:id',
  validate({ params: teacherIdParam, body: updateTeacherBody }),
  c.updateTeacher,
);
teachersAdminRouter.post(
  '/teachers/:id/link',
  validate({ params: teacherIdParam, body: linkTeacherBody }),
  c.link,
);
teachersAdminRouter.post('/teachers/:id/unlink', validate({ params: teacherIdParam }), c.unlink);
teachersAdminRouter.post(
  '/teacher-accounts/:userId/suspend',
  validate({ params: teacherAccountParam, body: reasonBody }),
  c.accountAction('suspend'),
);
teachersAdminRouter.post(
  '/teacher-accounts/:userId/remove',
  validate({ params: teacherAccountParam, body: reasonBody }),
  c.accountAction('remove'),
);
teachersAdminRouter.post(
  '/teacher-accounts/:userId/reactivate',
  validate({ params: teacherAccountParam }),
  c.accountAction('reactivate'),
);
teachersAdminRouter.get(
  '/teacher-accounts',
  validate({ query: teacherAccountsQuery }),
  c.listAccounts,
);
