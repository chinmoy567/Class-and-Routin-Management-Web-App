import * as service from './auth.service.js';
import * as secondStep from './secondStep.service.js';
import { issueChallenge } from './captcha.service.js';
import { establishSession } from './sessions.js';
import { assertCan } from '../../policy/index.js';
import { csrfToken } from '../../lib/csrf.js';

const accepted = (res) => res.status(202).json({ data: { accepted: true } });

export const csrf = (req, res) => res.json({ data: { token: csrfToken(req) } });

export async function captcha(_req, res) {
  res.json({ data: await issueChallenge() });
}

export async function signUp(req, res) {
  await service.signUp(req.body);
  accepted(res);
}

export async function verify(req, res) {
  res.json({ data: await service.verifyEmail(req.body.token) });
}

export async function resend(req, res) {
  await service.resendVerification(req.body.email);
  accepted(res);
}

export async function login(req, res) {
  const { requestUser, secondStepPending, next } = await service.logIn(req.body, { ip: req.ip });
  await establishSession(req, requestUser, { secondStepPending });
  res.json({ data: { next } });
}

export async function logout(req, res) {
  await new Promise((resolve) => req.session.destroy(resolve));
  res.status(204).end();
}

export async function secondStepCode(req, res) {
  res.json({ data: await secondStep.verifySecondStep(req, req.body.code) });
}

export async function emailCode(req, res) {
  await secondStep.sendEmailCode(req);
  accepted(res);
}

export async function totpSetup(req, res) {
  res.json({ data: await secondStep.setupTotp(req) });
}

export async function totpConfirm(req, res) {
  res.json({ data: await secondStep.confirmTotp(req, req.body.code) });
}

export async function resetRequest(req, res) {
  await service.requestPasswordReset(req.body.email);
  accepted(res);
}

export async function resetConfirm(req, res) {
  await service.confirmPasswordReset(req.body);
  res.json({ data: { ok: true } });
}

export async function changePassword(req, res) {
  await service.changePassword(req.user, req.sessionID, req.body);
  res.json({ data: { ok: true } });
}

export async function me(req, res) {
  assertCan(req.user, 'account.view_me');
  res.json({ data: await service.getMe(req.user, req.session) });
}
