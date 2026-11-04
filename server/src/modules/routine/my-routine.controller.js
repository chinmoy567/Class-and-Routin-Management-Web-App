import { z } from 'zod';
import { assertCan, stateIn } from '../../policy/index.js';
import { AppError } from '../../lib/errors.js';
import { getMyRoutine } from './my-routine.service.js';
import { dateString } from '@crm/shared/schemas';

/** A YYYY-MM-DD string that is a real calendar day (2027-02-30 and 2027-13-45 are not). */
const realDate = dateString.refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Not a real date');

const querySchema = z
  .object({
    from: realDate.optional(),
    to: realDate.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.from && v.to) {
      const [fy, fm, fd] = v.from.split('-').map(Number);
      const [ty, tm, td] = v.to.split('-').map(Number);
      const fromMs = Date.UTC(fy, fm - 1, fd);
      const toMs = Date.UTC(ty, tm - 1, td);
      const days = (toMs - fromMs) / 86_400_000;
      if (days < 0) {
        ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be >= from' });
      } else if (days > 13) {
        // RTN-06: at most 14 calendar days inclusive, so to − from ≤ 13.
        ctx.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'Range may not exceed 14 days',
        });
      }
    }
  });

export async function myRoutineHandler(req, res) {
  // RTN-04: any state other than `active` gets STATE_NOT_ALLOWED (the client shows its screen).
  if (!stateIn(req.user, 'active')) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot view its routine yet.');
  }
  assertCan(req.user, 'routine.my.read');

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Validation failed.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const data = await getMyRoutine(req.user, parsed.data);
  res.json({ data });
}
