import { Router } from 'express';
import { validate } from '../../lib/validate.js';
import { limitByIp } from '../../lib/rateLimit.js';
import { requireAuth } from './auth.middleware.js';
import * as schemas from './auth.schemas.js';
import * as controller from './auth.controller.js';

const HOUR = 60 * 60 * 1000;

// Per-IP limits (AUTH-09, AUTH-25). Per-address limits live in the service.
const signupLimit = limitByIp({ prefix: 'signup', windowMs: HOUR, limit: 5 });
const resetLimit = limitByIp({ prefix: 'reset-ip', windowMs: HOUR, limit: 10 });
const captchaLimit = limitByIp({ prefix: 'captcha', windowMs: 15 * 60 * 1000, limit: 30 });

export const authRouter = Router();

authRouter.get('/csrf', controller.csrf); // FND-28
authRouter.get('/captcha', captchaLimit, controller.captcha);

authRouter.post('/signup', signupLimit, validate({ body: schemas.signupBody }), controller.signUp);
authRouter.post('/verify', validate({ body: schemas.verifyBody }), controller.verify);
authRouter.post('/verify/resend', validate({ body: schemas.resendBody }), controller.resend);

authRouter.post('/login', validate({ body: schemas.loginBody }), controller.login);
authRouter.post('/logout', requireAuth, controller.logout);

authRouter.post(
  '/second-step',
  requireAuth,
  validate({ body: schemas.secondStepBody }),
  controller.secondStepCode,
);
authRouter.post('/second-step/email-code', requireAuth, controller.emailCode);
authRouter.post('/totp/setup', requireAuth, controller.totpSetup);
authRouter.post(
  '/totp/confirm',
  requireAuth,
  validate({ body: schemas.secondStepBody }),
  controller.totpConfirm,
);

authRouter.post(
  '/reset/request',
  resetLimit,
  validate({ body: schemas.resetRequestBody }),
  controller.resetRequest,
);
authRouter.post(
  '/reset/confirm',
  validate({ body: schemas.resetConfirmBody }),
  controller.resetConfirm,
);

authRouter.get('/me', requireAuth, controller.me);

// Mounted at /api/me
export const meRouter = Router();
meRouter.post(
  '/password',
  requireAuth,
  validate({ body: schemas.changePasswordBody }),
  controller.changePassword,
);
