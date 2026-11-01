import { Router } from 'express';
import { adminUserIdParam, grantAdminBody, roleIdParam, userSearchQuery } from '@crm/shared';
import { validate } from '../../lib/validate.js';
import * as controller from './adminRoles.controller.js';

// Mounted at /api/admin behind requireAuth (spec 03). 'admin_role.manage' is checked in the service.
export const adminRolesRouter = Router();

adminRolesRouter.get('/admins', controller.list);
adminRolesRouter.post('/admins', validate({ body: grantAdminBody }), controller.grant);
adminRolesRouter.delete('/admins/:roleId', validate({ params: roleIdParam }), controller.remove);
adminRolesRouter.post(
  '/admins/:userId/reset-password',
  validate({ params: adminUserIdParam }),
  controller.resetPassword,
);
adminRolesRouter.post(
  '/admins/:userId/reset-second-step',
  validate({ params: adminUserIdParam }),
  controller.resetSecondStep,
);
adminRolesRouter.get('/users/search', validate({ query: userSearchQuery }), controller.search);
