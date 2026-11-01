import { Router } from 'express';
import { createDepartmentBody, departmentIdParam, updateDepartmentBody } from '@crm/shared';
import { validate } from '../../lib/validate.js';
import * as controller from './department.controller.js';

// Mounted at /api/departments, before sign-in is required (DEP-04, used by sign-up).
export const departmentsPublicRouter = Router();
departmentsPublicRouter.get('/', controller.listPublic);

// Mounted at /api/admin behind requireAuth. 'department.manage' is checked in the service.
export const departmentsAdminRouter = Router();
departmentsAdminRouter.get('/departments', controller.listAdmin);
departmentsAdminRouter.post(
  '/departments',
  validate({ body: createDepartmentBody }),
  controller.create,
);
departmentsAdminRouter.patch(
  '/departments/:id',
  validate({ params: departmentIdParam, body: updateDepartmentBody }),
  controller.update,
);
departmentsAdminRouter.post(
  '/departments/:id/retire',
  validate({ params: departmentIdParam }),
  controller.retire,
);
