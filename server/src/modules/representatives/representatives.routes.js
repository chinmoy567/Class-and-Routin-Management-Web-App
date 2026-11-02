import { Router } from 'express';
import {
  assignBody,
  representativeRoleParam,
  searchQuery,
  sectionIdParam,
  summaryQuery,
} from '@crm/shared';
import { validate } from '../../lib/validate.js';
import * as c from './representatives.controller.js';

// Mounted at /api/admin behind requireAuth. The 'representative.*' policies run in the services.
export const representativesRouter = Router();
representativesRouter.get(
  '/sections/:id/representatives',
  validate({ params: sectionIdParam }),
  c.view,
);
representativesRouter.post(
  '/sections/:id/representatives',
  validate({ params: sectionIdParam, body: assignBody }),
  c.assign,
);
representativesRouter.post(
  '/sections/:id/representatives/reappoint',
  validate({ params: sectionIdParam }),
  c.reappointAll,
);
representativesRouter.delete(
  '/representatives/:roleId',
  validate({ params: representativeRoleParam }),
  c.remove,
);
representativesRouter.get('/students/search', validate({ query: searchQuery }), c.search);
representativesRouter.get(
  '/semesters/:id/representatives/summary',
  validate({ params: sectionIdParam, query: summaryQuery }),
  c.summaryOf,
);
