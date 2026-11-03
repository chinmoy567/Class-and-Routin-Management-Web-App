import { Router } from 'express';
import {
  auditQuery,
  dashboardQuery,
  deactivateBody,
  flagIdParam,
  flagsQuery,
  resolveFlagBody,
  studentIdParam,
  studentsQuery,
} from '@crm/shared';
import { validate } from '../../lib/validate.js';
import * as c from './admin.controller.js';

// Mounted at /api/admin behind requireAuth. Each service checks its own policy.
export const adminRouter = Router();

adminRouter.get('/dashboard', validate({ query: dashboardQuery }), c.dashboard);

adminRouter.get('/students', validate({ query: studentsQuery }), c.searchStudents);
adminRouter.post(
  '/students/:id/deactivate',
  validate({ params: studentIdParam, body: deactivateBody }),
  c.deactivate,
);
adminRouter.post('/students/:id/reactivate', validate({ params: studentIdParam }), c.reactivate);
adminRouter.post('/students/:id/graduate', validate({ params: studentIdParam }), c.graduate);
adminRouter.post('/students/:id/ungraduate', validate({ params: studentIdParam }), c.ungraduate);
adminRouter.post(
  '/students/:id/temp-password',
  validate({ params: studentIdParam }),
  c.tempPassword,
);

adminRouter.get('/flags', validate({ query: flagsQuery }), c.flags);
adminRouter.post(
  '/flags/:id/resolve',
  validate({ params: flagIdParam, body: resolveFlagBody }),
  c.resolve,
);

// ADM-19: read-only. There is deliberately no PATCH, PUT or DELETE on the audit log.
adminRouter.get('/audit', validate({ query: auditQuery }), c.audit);
