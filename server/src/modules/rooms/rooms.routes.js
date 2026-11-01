import { Router } from 'express';
import {
  adminRoomsQuery,
  createAliasBody,
  createRoomBody,
  roomAliasParams,
  roomIdParam,
  setSharesBody,
  updateRoomBody,
} from '@crm/shared';
import { validate } from '../../lib/validate.js';
import * as controller from './rooms.controller.js';

// Mounted at /api/rooms behind requireAuth. The 'room.*' policies are checked in the service.
export const roomsRouter = Router();
roomsRouter.get('/', controller.listActive);

// Mounted at /api/admin behind requireAuth.
export const roomsAdminRouter = Router();
roomsAdminRouter.get('/rooms', validate({ query: adminRoomsQuery }), controller.listAdmin);
roomsAdminRouter.post('/rooms', validate({ body: createRoomBody }), controller.create);
roomsAdminRouter.patch(
  '/rooms/:id',
  validate({ params: roomIdParam, body: updateRoomBody }),
  controller.update,
);
roomsAdminRouter.post(
  '/rooms/:id/aliases',
  validate({ params: roomIdParam, body: createAliasBody }),
  controller.addAlias,
);
roomsAdminRouter.delete(
  '/rooms/:id/aliases/:aliasId',
  validate({ params: roomAliasParams }),
  controller.removeAlias,
);
roomsAdminRouter.put(
  '/rooms/:id/shares',
  validate({ params: roomIdParam, body: setSharesBody }),
  controller.setShares,
);
roomsAdminRouter.post('/rooms/:id/retire', validate({ params: roomIdParam }), controller.retire);
