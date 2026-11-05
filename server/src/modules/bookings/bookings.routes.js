import { Router } from 'express';
import {
  roomRequestCancelBody,
  roomRequestDecisionBody,
  roomRequestIdParam,
  roomRequestNoShowBody,
  roomRequestQueueQuery,
  sendRoomRequestBody,
} from '@crm/shared';
import { validate } from '../../lib/validate.js';
import { requireAuth } from '../auth/index.js';
import * as c from './bookings.controller.js';

// Mounted at /api. Every route needs a session; the 'room_request.*' policies run in the services.
export const roomRequestRouter = Router();
roomRequestRouter.post(
  '/room-requests',
  requireAuth,
  validate({ body: sendRoomRequestBody }),
  c.send,
);
roomRequestRouter.get('/me/room-requests', requireAuth, c.mine);
roomRequestRouter.get(
  '/admin/room-requests',
  requireAuth,
  validate({ query: roomRequestQueueQuery }),
  c.queue,
);
roomRequestRouter.post(
  '/room-requests/:id/decision',
  requireAuth,
  validate({ params: roomRequestIdParam, body: roomRequestDecisionBody }),
  c.decide,
);
roomRequestRouter.post(
  '/room-requests/:id/cancel',
  requireAuth,
  validate({ params: roomRequestIdParam, body: roomRequestCancelBody }),
  c.cancelRequest,
);
roomRequestRouter.post(
  '/room-requests/:id/no-show',
  requireAuth,
  validate({ params: roomRequestIdParam, body: roomRequestNoShowBody }),
  c.noShow,
);
