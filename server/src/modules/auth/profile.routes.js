import express, { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { AppError } from '../../lib/errors.js';
import {
  changeEmailBody,
  confirmEmailBody,
  renameBody,
  updateProfileBody,
  userIdParam,
} from '@crm/shared';
import { requireAuth } from './auth.middleware.js';
import { PHOTO_MAX_BYTES } from './photo.service.js';
import * as controller from './profile.controller.js';

// PRF-04: the photo arrives as the raw request body (JPEG, PNG or WebP), at most 2 MB.
const readPhotoBody = express.raw({
  type: ['image/*', 'application/octet-stream'],
  limit: PHOTO_MAX_BYTES,
});
function photoBody(req, res, next) {
  readPhotoBody(req, res, (err) => {
    if (err?.type === 'entity.too.large') {
      return next(new AppError(413, 'FILE_TOO_LARGE', 'The photo must be 2 MB or smaller.'));
    }
    next(err);
  });
}

// Mounted at /api/me
export const meProfileRouter = Router();
meProfileRouter.get('/profile', requireAuth, controller.getProfile);
meProfileRouter.patch(
  '/profile',
  requireAuth,
  validate({ body: updateProfileBody }),
  controller.patchProfile,
);
meProfileRouter.put('/photo', requireAuth, photoBody, controller.putPhoto);
meProfileRouter.delete('/photo', requireAuth, controller.removePhoto);
meProfileRouter.post(
  '/email',
  requireAuth,
  validate({ body: changeEmailBody }),
  controller.requestEmail,
);
// Anyone with the link: the one-time token is the credential (PRF-05).
meProfileRouter.post(
  '/email/confirm',
  validate({ body: confirmEmailBody }),
  controller.confirmEmail,
);

// Mounted at /api/users
export const usersRouter = Router();
usersRouter.get('/:id/photo', requireAuth, validate({ params: userIdParam }), controller.userPhoto);
usersRouter.get('/:id', requireAuth, validate({ params: userIdParam }), controller.publicProfile);

// Mounted at /api/admin (already behind requireAuth)
export const adminUsersRouter = Router();
adminUsersRouter.patch(
  '/users/:id/name',
  validate({ params: userIdParam, body: renameBody }),
  controller.rename,
);
