import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { eventProblems, EVENT_KINDS } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

const inputClass = 'h-11 w-full rounded-md border bg-background px-3 text-sm';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Kinds that take a cutoff time (CAL-01). `dept_event` may take one; the others may not. */
const takesCutoff = (kind) => kind === 'early_closing' || kind === 'dept_event';

/** "12:00" → 720. Anything else → null. */
export function toCutoffMin(text) {
  if (!TIME.test(text ?? '')) return null;
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
}

/** The form's values as the server's event body (CAL-01). */
export function toEventBody(values) {
  return {
    scope: values.scope,
    from_date: values.from_date,
    to_date: values.to_date,
    kind: values.kind,
    cutoff_min: takesCutoff(values.kind) ? toCutoffMin(values.cutoff) : null,
    label: values.label.trim(),
  };
}

// The same rules as the server (CAL-01, CAL-03), shown next to the field they belong to.
const PROBLEM_TEXT = {
  to_date: () => t('calendar.errors.dateOrder'),
  scope: () => t('calendar.errors.deptScope'),
  cutoff_min: (values) =>
    values.kind === 'early_closing'
      ? t('calendar.errors.cutoffRequired')
      : t('calendar.errors.cutoffNotAllowed'),
};

const schema = z
  .object({
    scope: z.string().min(1, { message: t('calendar.errors.scopeRequired') }),
    from_date: z.string().regex(DATE, { message: t('calendar.errors.dateRequired') }),
    to_date: z.string().regex(DATE, { message: t('calendar.errors.dateRequired') }),
    kind: z.enum(EVENT_KINDS),
    cutoff: z.string(),
    label: z
      .string()
      .trim()
      .min(1, { message: t('calendar.errors.labelRequired') })
      .max(80, { message: t('calendar.errors.labelRequired') }),
  })
  .superRefine((values, ctx) => {
    if (values.cutoff && takesCutoff(values.kind) && toCutoffMin(values.cutoff) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cutoff'],
        message: t('calendar.errors.cutoffFormat'),
      });
      return;
    }
    const body = toEventBody(values);
    for (const [path] of eventProblems(body)) {
      const field = path === 'cutoff_min' ? 'cutoff' : path;
      ctx.addIssue({ code: 'custom', path: [field], message: PROBLEM_TEXT[path](values) });
    }
  });

/**
 * Add or edit one calendar event. `save(body)` resolves to `{ saved: true }` or
 * `{ saved: false, affected_bookings }` (CAL-13); the second answer asks the admin to confirm.
 * `scopeChoices` is `[{ value, label }]`: 'university' only for a super admin (CAL-02).
 */
export function EventDialog({ event, scopeChoices, save, onClose }) {
  const heading = useRef(null);
  const [pending, setPending] = useState(null); // { body, bookings }
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      scope: event ? (event.scope_department_id ?? 'university') : (scopeChoices[0]?.value ?? ''),
      from_date: event?.from_date ?? '',
      to_date: event?.to_date ?? '',
      kind: event?.kind ?? 'holiday',
      cutoff: event?.cutoff_min == null ? '' : minutesToTime(event.cutoff_min),
      label: event?.label ?? '',
    },
  });
  const { register, handleSubmit, watch, formState } = form;
  const kind = watch('kind');

  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function send(body) {
    setSaving(true);
    setError(null);
    try {
      const res = await save(body);
      if (res.saved) return onClose({ saved: true });
      setPending({ body, bookings: res.affected_bookings ?? [] });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const submit = handleSubmit((values) => send(toEventBody(values)));
  const errors = formState.errors;

  if (pending) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-affected-h"
        className="space-y-3 rounded-md border bg-background p-4 shadow-lg"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="event-affected-h" className="text-lg font-semibold">
          {t('calendar.affected.title')}
        </h2>
        <p className="text-sm">{t('calendar.affected.body', { count: pending.bookings.length })}</p>
        <FormError error={error} />
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={saving}
            onClick={() => send({ ...pending.body, confirm: true })}
          >
            {t('calendar.affected.saveAnyway')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onClose()}>
            {t('calendar.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-dialog-h"
      className="space-y-4 rounded-md border bg-background p-4 shadow-lg"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <h2 id="event-dialog-h" ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {event ? t('calendar.dialogEdit') : t('calendar.dialogAdd')}
      </h2>
      <form noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="event-scope" className="block text-sm font-medium">
            {t('calendar.scope')}
          </label>
          <select id="event-scope" className={inputClass} {...register('scope')}>
            {scopeChoices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <FieldError message={errors.scope?.message} id="event-scope-err" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event-kind" className="block text-sm font-medium">
            {t('calendar.kind')}
          </label>
          <select id="event-kind" className={inputClass} {...register('kind')}>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`calendar.kinds.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event-from" className="block text-sm font-medium">
            {t('calendar.fromDate')}
          </label>
          <input
            id="event-from"
            type="date"
            className={inputClass}
            aria-invalid={errors.from_date ? true : undefined}
            aria-describedby={errors.from_date ? 'event-from-err' : undefined}
            {...register('from_date')}
          />
          <FieldError message={errors.from_date?.message} id="event-from-err" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event-to" className="block text-sm font-medium">
            {t('calendar.toDate')}
          </label>
          <input
            id="event-to"
            type="date"
            className={inputClass}
            aria-invalid={errors.to_date ? true : undefined}
            aria-describedby={errors.to_date ? 'event-to-err' : undefined}
            {...register('to_date')}
          />
          <FieldError message={errors.to_date?.message} id="event-to-err" />
        </div>
        {takesCutoff(kind) && (
          <div className="space-y-1.5">
            <label htmlFor="event-cutoff" className="block text-sm font-medium">
              {t('calendar.cutoff')}
            </label>
            <input
              id="event-cutoff"
              type="time"
              step={300}
              className={inputClass}
              aria-describedby={`event-cutoff-hint${errors.cutoff ? ' event-cutoff-err' : ''}`}
              aria-invalid={errors.cutoff ? true : undefined}
              {...register('cutoff')}
            />
            <p id="event-cutoff-hint" className="text-xs text-muted-foreground">
              {t('calendar.cutoffHint')}
            </p>
            <FieldError message={errors.cutoff?.message} id="event-cutoff-err" />
          </div>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="event-label" className="block text-sm font-medium">
            {t('calendar.label')}
          </label>
          <input
            id="event-label"
            maxLength={80}
            className={inputClass}
            aria-describedby={`event-label-hint${errors.label ? ' event-label-err' : ''}`}
            aria-invalid={errors.label ? true : undefined}
            {...register('label')}
          />
          <p id="event-label-hint" className="text-xs text-muted-foreground">
            {t('calendar.labelHint')}
          </p>
          <FieldError message={errors.label?.message} id="event-label-err" />
        </div>
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={saving}>
            {saving ? t('calendar.saving') : t('calendar.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onClose()}>
            {t('calendar.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FieldError({ message, id }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** 720 → "12:00". */
export function minutesToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}
