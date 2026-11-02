import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { slotFormSchema } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { WarningsStep } from './WarningsStep.jsx';

const toTeachers = (text) =>
  text.trim().toUpperCase() === 'TBA'
    ? 'TBA'
    : text
        .split(/[,+]/)
        .map((x) => x.trim())
        .filter(Boolean);

const defaults = (slot) => ({
  group: slot?.group ?? '',
  day_of_week: slot?.day_of_week ?? 0,
  start: slot?.start ?? '',
  end: slot?.end ?? '',
  course_code: slot?.course_code ?? '',
  course_name: slot?.course_name ?? '',
  teachers: slot?.teachers === 'TBA' ? 'TBA' : '',
  room: slot?.room ?? '',
});

const inputClass = 'h-11 w-full rounded-md border bg-background px-3 text-sm';

/**
 * Add or edit one class. `save(body)` resolves to the server answer: `{ saved: true }` or
 * `{ saved: false, warnings, booking_clashes }`. Errors are thrown (SLOT_INVALID has `issues`).
 */
export function SlotDialog({ slot, groups, save, onClose }) {
  const heading = useRef(null);
  const form = useForm({ resolver: zodResolver(slotFormSchema), defaultValues: defaults(slot) });
  const { register, handleSubmit, formState } = form;
  const [pending, setPending] = useState(null); // { body, warnings, bookings }
  const [combineWith, setCombineWith] = useState(null);
  const [bookingAction, setBookingAction] = useState(undefined);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function send(body) {
    setSaving(true);
    setError(null);
    try {
      const res = await save(body);
      if (res.saved) return onClose();
      setPending({ body, warnings: res.warnings ?? [], bookings: res.booking_clashes ?? [] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') return onClose({ conflict: true });
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const submit = handleSubmit((values) =>
    send({
      group: values.group || null,
      day_of_week: values.day_of_week,
      start: values.start,
      end: values.end,
      course_code: values.course_code,
      course_name: values.course_name || null,
      teachers: toTeachers(values.teachers),
      room: values.room,
    }),
  );

  const field = (name, label, props = {}) => (
    <div className="space-y-1.5">
      <label htmlFor={`slot-${name}`} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={`slot-${name}`}
        className={inputClass}
        aria-invalid={Boolean(formState.errors[name])}
        aria-describedby={formState.errors[name] ? `slot-${name}-err` : undefined}
        {...register(name)}
        {...props}
      />
      {formState.errors[name] && (
        <p id={`slot-${name}-err`} className="text-sm text-destructive">
          {t(`routineEdit.slot.fieldError.${name}`)}
        </p>
      )}
    </div>
  );

  const issues = error instanceof ApiError && error.code === 'SLOT_INVALID' ? error.issues : null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="slot-h"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className="space-y-3 rounded-md border bg-background p-4 shadow-lg"
    >
      <h2 id="slot-h" ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {t(slot ? 'routineEdit.slot.editTitle' : 'routineEdit.slot.addTitle')}
      </h2>
      {pending ? (
        <WarningsStep
          warnings={pending.warnings}
          bookings={pending.bookings}
          combineWith={combineWith}
          onCombine={setCombineWith}
          bookingAction={bookingAction}
          onBookingAction={setBookingAction}
          saving={saving}
          onBack={() => setPending(null)}
          onConfirm={() =>
            send({
              ...pending.body,
              confirm_warnings: true,
              ...(bookingAction ? { booking_action: bookingAction } : {}),
              ...(combineWith ? { combine_with_slot_id: combineWith } : {}),
            })
          }
        />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="slot-day_of_week" className="block text-sm font-medium">
              {t('routineEdit.slot.day')}
            </label>
            <select id="slot-day_of_week" className={inputClass} {...register('day_of_week')}>
              {[0, 1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {t(`routineEdit.days.${d}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('start', t('routineEdit.slot.start'), { type: 'time' })}
            {field('end', t('routineEdit.slot.end'), { type: 'time' })}
          </div>
          {field('course_code', t('routineEdit.slot.courseCode'))}
          {field('course_name', t('routineEdit.slot.courseName'))}
          {field('teachers', t('routineEdit.slot.teachers'))}
          {field('room', t('routineEdit.slot.room'))}
          <div className="space-y-1.5">
            <label htmlFor="slot-group" className="block text-sm font-medium">
              {t('routineEdit.slot.group')}
            </label>
            <select id="slot-group" className={inputClass} {...register('group')}>
              <option value="">{t('routineEdit.wholeSection')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.label}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          {issues ? (
            <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
              <p className="font-medium text-destructive">{t('routineEdit.slot.issues')}</p>
              <ul className="list-disc pl-5">
                {issues.map((i, n) => (
                  <li key={`${i.code}-${n}`}>{i.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <FormError error={error} />
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {t(saving ? 'routineEdit.slot.saving' : 'routineEdit.slot.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => onClose()}>
              {t('routineEdit.slot.cancel')}
            </Button>
          </div>
        </form>
      )}
      {pending && <FormError error={error} />}
    </div>
  );
}
