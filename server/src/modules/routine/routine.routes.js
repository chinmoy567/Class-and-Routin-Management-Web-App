import express, { Router } from 'express';
import {
  IMPORT_MAX_BYTES,
  importDepartmentQuery,
  importIdParam,
  importIssueParams,
  keepChoicesBody,
  publishBody,
  semesterIdParam,
} from '@crm/shared';
import { validate } from '../../lib/validate.js';
import { AppError } from '../../lib/errors.js';
import { requireAuth } from '../auth/index.js';
import * as c from './routine.controller.js';

// IMP-02: the workbook arrives as the raw request body (no multipart library is allowed).
const readFile = express.raw({ type: () => true, limit: IMPORT_MAX_BYTES });
function fileBody(req, res, next) {
  readFile(req, res, (err) => {
    if (err?.type === 'entity.too.large') {
      return next(new AppError(413, 'FILE_TOO_LARGE', 'The file must be 5 MB or smaller.'));
    }
    next(err);
  });
}

// Mounted at /api. Every route checks the 'import.*' policies in the service.
export const routineRouter = Router();
routineRouter.get(
  '/admin/imports/template',
  requireAuth,
  validate({ query: importDepartmentQuery }),
  c.template,
);
routineRouter.post(
  '/semesters/:id/imports',
  requireAuth,
  validate({ params: semesterIdParam, query: importDepartmentQuery }),
  fileBody,
  c.upload,
);
routineRouter.get(
  '/semesters/:id/imports',
  requireAuth,
  validate({ params: semesterIdParam, query: importDepartmentQuery }),
  c.list,
);
routineRouter.get('/imports/:id/preview', requireAuth, validate({ params: importIdParam }), c.preview);
routineRouter.post(
  '/imports/:id/issues/:issueId/confirm',
  requireAuth,
  validate({ params: importIssueParams }),
  c.confirm,
);
routineRouter.put(
  '/imports/:id/keep-choices',
  requireAuth,
  validate({ params: importIdParam, body: keepChoicesBody }),
  c.keepChoices,
);
routineRouter.post(
  '/imports/:id/publish',
  requireAuth,
  validate({ params: importIdParam, body: publishBody }),
  c.publishImport,
);
