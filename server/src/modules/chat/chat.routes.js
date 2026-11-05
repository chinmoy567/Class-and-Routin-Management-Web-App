import express, { Router } from 'express';
import { AppError } from '../../lib/errors.js';
import { FILE_MAX_BYTES } from './chat.files.service.js';
import { validate } from '../../lib/validate.js';
import { requireAuth } from '../auth/index.js';
import * as c from './chat.controller.js';
import {
  appealBody,
  fileDownloadQuery,
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

// Spec 21, FIL-03: the upload arrives as multipart/form-data, read whole but capped while streaming.
// The cap leaves room for the multipart boundaries around a 5 MB file.
const UPLOAD_OVERHEAD = 256 * 1024;
const readUploadBody = express.raw({
  type: 'multipart/form-data',
  limit: FILE_MAX_BYTES + UPLOAD_OVERHEAD,
});
function uploadBody(req, res, next) {
  readUploadBody(req, res, (err) => {
    if (err?.type === 'entity.too.large') {
      return next(new AppError(413, 'FILE_TOO_LARGE', 'A file can be 5 MB or smaller.'));
    }
    next(err);
  });
}

chatRouter.post(
  '/conversations/:id/files',
  requireAuth,
  validate({ params: idParam }),
  uploadBody,
  c.uploadFile,
);
chatRouter.post('/files/:id/link', requireAuth, validate({ params: idParam }), c.fileLink);
chatRouter.get(
  '/files/:id/download',
  requireAuth,
  validate({ params: idParam, query: fileDownloadQuery }),
  c.downloadFile,
);
