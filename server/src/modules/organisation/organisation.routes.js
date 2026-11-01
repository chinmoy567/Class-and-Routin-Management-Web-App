import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { addDomainBody, domainParams } from './organisation.schemas.js';
import * as controller from './organisation.controller.js';

// Mounted at /api/admin behind requireAuth (see app.js). AUTH-28. Permission
// ('email_domain.manage') is checked in the service.
export const organisationRouter = Router();

organisationRouter.get('/email-domains', controller.list);
organisationRouter.post('/email-domains', validate({ body: addDomainBody }), controller.add);
organisationRouter.delete(
  '/email-domains/:domain',
  validate({ params: domainParams }),
  controller.remove,
);
