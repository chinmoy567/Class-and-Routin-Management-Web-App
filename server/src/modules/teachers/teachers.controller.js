import * as registrations from './registration.service.js';
import * as directory from './directory.service.js';
import { changeTeacherState, listTeacherAccounts } from './account.service.js';

export const listRegistrations = async (req, res) =>
  res.json({ data: await registrations.listRegistrations(req.user, req.query) });
export const decide = async (req, res) =>
  res.json({ data: await registrations.decide(req.user, req.params.id, req.body) });
export const applyAgain = async (req, res) =>
  res.status(201).json({ data: await registrations.applyAgain(req.user, req.body) });
export const myRegistration = async (req, res) =>
  res.json({ data: await registrations.myRegistration(req.user) });

export const listTeachers = async (req, res) =>
  res.json({ data: await directory.listTeachers(req.user, req.query.department_id) });
export const createTeacher = async (req, res) =>
  res.status(201).json({ data: await directory.createTeacher(req.user, req.body) });
export const updateTeacher = async (req, res) =>
  res.json({ data: await directory.updateTeacher(req.user, req.params.id, req.body) });
export const link = async (req, res) =>
  res.json({ data: await directory.linkTeacher(req.user, req.params.id, req.body.user_id) });
export const unlink = async (req, res) =>
  res.json({ data: await directory.unlinkTeacher(req.user, req.params.id) });

export const accountAction = (action) => async (req, res) =>
  res.json({
    data: await changeTeacherState(req.user, req.params.userId, action, req.body?.reason),
  });
export const listAccounts = async (req, res) =>
  res.json({ data: await listTeacherAccounts(req.user, req.query.department_id) });
