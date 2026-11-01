import { z } from 'zod';

const objectIdString = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const semesterName = z.string({ error: 'is required' }).trim().min(2, 'Enter a name').max(60);

/** A real calendar date written YYYY-MM-DD. */
const realDate = dateString.refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Enter a real date');

export const createSemesterBody = z
  .strictObject({ name: semesterName, start_date: realDate, end_date: realDate })
  .refine((v) => v.end_date > v.start_date, {
    path: ['end_date'],
    message: 'The end date must be after the start date',
  });

/** Partial edit: the server checks end > start again on the merged values. */
export const updateSemesterBody = z
  .strictObject({
    name: semesterName.optional(),
    start_date: realDate.optional(),
    end_date: realDate.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.start_date !== undefined || v.end_date !== undefined,
    'Nothing to change',
  )
  .refine((v) => !v.start_date || !v.end_date || v.end_date > v.start_date, {
    path: ['end_date'],
    message: 'The end date must be after the start date',
  });

export const semesterIdParam = z.object({ id: objectIdString });
