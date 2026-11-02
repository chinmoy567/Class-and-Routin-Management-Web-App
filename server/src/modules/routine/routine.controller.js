import * as imports from './import.service.js';
import * as publish from './publish.service.js';
import { buildTemplate } from './template.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function template(req, res) {
  const buffer = await buildTemplate(req.user, req.query.department_id);
  res.set({
    'Content-Type': XLSX,
    'Content-Disposition': 'attachment; filename="routine-template.xlsx"',
  });
  res.send(buffer);
}
export async function upload(req, res) {
  const data = await imports.uploadImport(
    req.user,
    req.params.id,
    req.query.department_id,
    req.body,
  );
  res.status(201).json({ data });
}
export async function list(req, res) {
  res.json({
    data: await imports.listImports(req.user, req.params.id, req.query.department_id),
  });
}
export async function preview(req, res) {
  res.json({ data: await imports.previewImport(req.user, req.params.id) });
}
export async function confirm(req, res) {
  res.json({ data: await imports.confirmIssue(req.user, req.params.id, req.params.issueId) });
}
export async function keepChoices(req, res) {
  res.json({ data: await imports.setKeepChoices(req.user, req.params.id, req.body) });
}
export async function publishImport(req, res) {
  res.json({ data: await publish.publishImport(req.user, req.params.id, req.body) });
}
