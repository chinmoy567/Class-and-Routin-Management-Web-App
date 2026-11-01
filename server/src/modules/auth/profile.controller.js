import * as profile from './profile.service.js';
import * as photo from './photo.service.js';
import * as emailChange from './emailChange.service.js';

export async function getProfile(req, res) {
  res.json({ data: await profile.getOwnProfile(req.user) });
}

export async function patchProfile(req, res) {
  res.json({ data: await profile.updatePhone(req.user, req.body.phone) });
}

export async function publicProfile(req, res) {
  res.json({ data: await profile.getPublicProfile(req.user, req.params.id) });
}

export async function rename(req, res) {
  res.json({ data: await profile.renameUser(req.user, req.params.id, req.body.full_name) });
}

export async function putPhoto(req, res) {
  res.status(202).json({ data: await photo.uploadPhoto(req.user, req.body) });
}

export async function removePhoto(req, res) {
  await photo.deletePhoto(req.user);
  res.status(204).end();
}

export async function userPhoto(req, res) {
  await photo.sendUserPhoto(req.params.id, res);
}

export async function requestEmail(req, res) {
  await emailChange.requestEmailChange(req.user, req.body.new_email);
  res.status(202).json({ data: { accepted: true } });
}

export async function confirmEmail(req, res) {
  await emailChange.confirmEmailChange(req.body.token);
  res.json({ data: { ok: true } });
}
