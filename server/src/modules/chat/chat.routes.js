import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { requireAuth } from '../auth/index.js';
import * as c from './chat.controller.js';
import {
  appealBody,
  directBody,
  idParam,
  memberParams,
  messageBody,
  messagesQuery,
  peopleQuery,
  restoreParams,
} from './chat.schemas.js';

// Mounted at /api/chat. Every route needs a session; the chat.* policies run in the services.
export const chatRouter = Router();
chatRouter.get('/people', requireAuth, validate({ query: peopleQuery }), c.searchPeople);
chatRouter.get('/conversations', requireAuth, c.listConversations);
chatRouter.post('/direct', requireAuth, validate({ body: directBody }), c.openDirect);
chatRouter.get('/unread', requireAuth, c.unread);
chatRouter.get(
  '/conversations/:id/messages',
  requireAuth,
  validate({ params: idParam, query: messagesQuery }),
  c.listMessages,
);
chatRouter.post(
  '/conversations/:id/messages',
  requireAuth,
  validate({ params: idParam, body: messageBody }),
  c.sendMessage,
);
chatRouter.delete('/messages/:id', requireAuth, validate({ params: idParam }), c.deleteMessage);
chatRouter.post('/conversations/:id/read', requireAuth, validate({ params: idParam }), c.markRead);
chatRouter.post(
  '/messages/:id/delivered',
  requireAuth,
  validate({ params: idParam }),
  c.markDelivered,
);
chatRouter.get(
  '/conversations/:id/members',
  requireAuth,
  validate({ params: idParam }),
  c.listMembers,
);
chatRouter.delete(
  '/conversations/:id/members/:userId',
  requireAuth,
  validate({ params: memberParams }),
  c.removeMember,
);
chatRouter.post(
  '/conversations/:id/appeal',
  requireAuth,
  validate({ params: idParam, body: appealBody }),
  c.appeal,
);

// Mounted at /api/admin (CHT-10a).
export const chatAdminRouter = Router();
chatAdminRouter.get('/chat/appeals', requireAuth, c.listAppeals);
chatAdminRouter.post(
  '/chat/members/:memberId/restore',
  requireAuth,
  validate({ params: restoreParams }),
  c.restoreMember,
);
