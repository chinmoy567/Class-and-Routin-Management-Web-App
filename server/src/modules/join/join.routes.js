import { Router } from 'express';
import {
  adminJoinQuery,
  appealDecisionBody,
  claimDecisionBody,
  createEnrolmentBody,
  enrolmentIdParam,
  enrolmentGroupBody,
  joinDecisionBody,
  joinRequestsQuery,
  ownClaimBody,
  revokeBody,
  sectionIdParam,
} from '@crm/shared';
import { validate } from '../../lib/validate.js';
import { requireAuth } from '../auth/index.js';
import * as c from './join.controller.js';

// Mounted at /api. Every route needs a session; the 'join.*' policies run in the services.
export const joinRouter = Router();
joinRouter.get('/join/options', requireAuth, c.options);
joinRouter.post('/enrolments', requireAuth, validate({ body: createEnrolmentBody }), c.create);
joinRouter.post(
  '/enrolments/:id/withdraw',
  requireAuth,
  validate({ params: enrolmentIdParam }),
  c.withdraw,
);
joinRouter.get('/me/join-request', requireAuth, c.mine);
joinRouter.post('/me/uv-claim', requireAuth, validate({ body: ownClaimBody }), c.ownClaim);
joinRouter.get(
  '/sections/:id/join-requests',
  requireAuth,
  validate({ params: sectionIdParam, query: joinRequestsQuery }),
  c.sectionRequests,
);
joinRouter.post(
  '/enrolments/:id/decision',
  requireAuth,
  validate({ params: enrolmentIdParam, body: joinDecisionBody }),
  c.decide,
);
joinRouter.patch(
  '/enrolments/:id/group',
  requireAuth,
  validate({ params: enrolmentIdParam, body: enrolmentGroupBody }),
  c.group,
);
joinRouter.post(
  '/enrolments/:id/appeal',
  requireAuth,
  validate({ params: enrolmentIdParam }),
  c.appeal,
);
joinRouter.post(
  '/admin/enrolments/:id/appeal-decision',
  requireAuth,
  validate({ params: enrolmentIdParam, body: appealDecisionBody }),
  c.appealDecision,
);
joinRouter.post(
  '/admin/uv-claims/:id/revoke',
  requireAuth,
  validate({ params: enrolmentIdParam, body: revokeBody }),
  c.revoke,
);
joinRouter.post(
  '/admin/uv-claims/:id/decision',
  requireAuth,
  validate({ params: enrolmentIdParam, body: claimDecisionBody }),
  c.claimDecision,
);
joinRouter.get(
  '/admin/join-requests',
  requireAuth,
  validate({ query: adminJoinQuery }),
  c.adminList,
);
