import { z } from 'zod';
const objectIdString = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024; // IMP-02
export const IMPORT_STATUSES = Object.freeze(['checked', 'failed', 'published', 'replaced']);
export const KEEP_CHOICES = Object.freeze(['keep', 'replace']);

/** The Routine sheet columns, in order (IMP-01). */
export const ROUTINE_COLUMNS = Object.freeze([
  'Department',
  'Level',
  'Term',
  'Section',
  'Group',
  'Day',
  'Start',
  'End',
  'Course code',
  'Course name',
  'Teachers',
  'Room',
]);
/** The Teachers sheet columns (IMP-01). */
export const TEACHER_COLUMNS = Object.freeze(['Department', 'Short code', 'Full name']);

export const importDepartmentQuery = z.object({ department_id: objectIdString.optional() });
export const importIdParam = z.object({ id: objectIdString });
export const importIssueParams = z.object({
  id: objectIdString,
  issueId: z.string().regex(/^\d{1,6}$/, 'Invalid issue id'),
});
/** IMP-24: `{ <slotId>: 'keep' | 'replace' }`. */
export const keepChoicesBody = z.record(objectIdString, z.enum(KEEP_CHOICES), {
  error: 'Send keep or replace for each slot',
});
/** IMP-25 */
// IMP-19: the admin's choice for an approved booking that a published row would clash with.
export const publishBody = z.strictObject({
  warnings_reviewed: z.boolean().optional(),
  booking_action: z.enum(['keep_booking', 'cancel_booking']).optional(),
});
