import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useCancelClass, useUndoCancelClass } from '../hooks.js';

const inputClass = 'h-11 w-full rounded-md border bg-background px-3 text-sm';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The weekday of a YYYY-MM-DD date, Sunday = 0. Pure calendar arithmetic, no device clock. */
export function weekdayOfDate(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * CAL-10, CAL-12: one class on one date. The date must fall on the slot's weekday inside the
 * current semester. The server checks the same rules again and has the last word.
 */
function dateSchema(slot, semester) {
  return z.object({
    date: z
      .string()
      .regex(DATE, { message: t('calendar.errors.dateRequired') })
      .superRefine((date, ctx) => {
        if (!DATE.test(date)) return; // the format message already shows
        if (weekdayOfDate(date) !== slot.day_of_week) {
          ctx.addIssue({
            code: 'custom',
            message: t('calendar.cancelClass.weekdayError', {
              day: t(`routineEdit.days.${slot.day_of_week}`),
            }),
          });
        }
        if (!semester || date < semester.start_date || date > semester.end_date) {
          ctx.addIssue({ code: 'custom', message: t('calendar.cancelClass.rangeError') });
        }
      }),
    reason: z.string().trim().max(500),
  });
}

/**
 * Cancel one class on one date, or restore a cancelled one. `slot` is a grid slot (`id`,
 * `course_code`, `day_of_week`, `start`, `end`). `semester` is `{ start_date, end_date }`.
 */
export function CancelClassDialog({ slot, semester, onClose }) {
  const heading = useRef(null);
  const cancel = useCancelClass();
  const undo = useUndoCancelClass();
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(dateSchema(slot, semester)),
    defaultValues: { date: '', reason: '' },
  });
  const { register, handleSubmit, formState, setError: setFieldError } = form;
  const errors = formState.errors;
  const busy = cancel.isPending || undo.isPending;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const onCancelClass = handleSubmit(async ({ date, reason }) => {
    if (!reason) {
      setFieldError('reason', { message: t('calendar.cancelClass.reasonRequired') });
      return;
    }
    setError(null);
    try {
      await cancel.mutateAsync({ id: slot.id, date, reason });
      setDone(t('calendar.cancelClass.done'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setError(null);
        setDone(null);
        setFieldError('date', { message: t('calendar.cancelClass.conflict') });
        return;
      }
      setError(err);
    }
  });

  const onRestore = handleSubmit(async ({ date }) => {
    setError(null);
    try {
      await undo.mutateAsync({ id: slot.id, date });
      setDone(t('calendar.cancelClass.restored'));
    } catch (err) {
      setError(err);
    }
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-class-h"
      className="space-y-4 rounded-md border bg-background p-4 shadow-lg"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <h2 id="cancel-class-h" ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {t('calendar.cancelClass.title')}
      </h2>
      <p className="text-sm">
        {t('calendar.cancelClass.body', {
          course: slot.course_code,
          day: t(`routineEdit.days.${slot.day_of_week}`),
          start: slot.start,
          end: slot.end,
        })}
      </p>
      <form noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="cancel-date" className="block text-sm font-medium">
            {t('calendar.cancelClass.date')}
          </label>
          <input
            id="cancel-date"
            type="date"
            min={semester?.start_date}
            max={semester?.end_date}
            className={inputClass}
            aria-describedby={`cancel-date-hint${errors.date ? ' cancel-date-err' : ''}`}
            aria-invalid={errors.date ? true : undefined}
            {...register('date')}
          />
          <p id="cancel-date-hint" className="text-xs text-muted-foreground">
            {t('calendar.cancelClass.dateHint', { day: t(`routineEdit.days.${slot.day_of_week}`) })}
          </p>
          {errors.date && (
            <p id="cancel-date-err" className="text-sm text-destructive">
              {errors.date.message}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cancel-reason" className="block text-sm font-medium">
            {t('calendar.cancelClass.reason')}
          </label>
          <textarea
            id="cancel-reason"
            rows={3}
            maxLength={500}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? 'cancel-reason-err' : undefined}
            {...register('reason')}
          />
          {errors.reason && (
            <p id="cancel-reason-err" className="text-sm text-destructive">
              {errors.reason.message}
            </p>
          )}
        </div>
        <FormError error={error} />
        {done && (
          <p role="status" className="text-sm">
            {done}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={onCancelClass}>
            {t('calendar.cancelClass.cancel')}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onRestore}>
            {t('calendar.cancelClass.restore')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onClose()}>
            {t('calendar.cancelClass.keep')}
          </Button>
        </div>
      </form>
    </div>
  );
}
