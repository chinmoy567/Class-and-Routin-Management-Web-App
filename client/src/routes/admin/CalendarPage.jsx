import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useIsSuperAdmin } from '@/features/auth/hooks.js';
import { useAdminDepartments, useCurrentSemester } from '@/features/admin/hooks.js';
import { EventDialog, minutesToTime } from '@/features/calendar/components/EventDialog.jsx';
import {
  useCalendarEvents,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useUpdateCalendarEvent,
} from '@/features/calendar/hooks.js';
import { useAdminDepartment } from '@/features/teachers/components/useAdminDepartment.jsx';
import { t } from '@/lib/i18n';

const inputClass = 'h-11 rounded-md border bg-background px-3 text-sm';

/** CAL-01 to CAL-05, CAL-13: the university calendar. Super admins see every scope; a department
 * admin sees the university events and manages only their own departments' events. */
export function CalendarPage() {
  const isSuper = useIsSuperAdmin();
  const { choices } = useAdminDepartment();
  const departments = useAdminDepartments();
  const semester = useCurrentSemester();
  const current = semester.data ?? null;

  // The range defaults to the current semester (the server's date, never the device clock).
  const [range, setRange] = useState(null); // { from, to } once the admin edits it
  const shown = range ?? { from: current?.start_date ?? '', to: current?.end_date ?? '' };
  const events = useCalendarEvents({
    from: shown.from || undefined,
    to: shown.to || undefined,
  });
  const create = useCreateCalendarEvent();
  const update = useUpdateCalendarEvent();
  const del = useDeleteCalendarEvent();

  const [dialog, setDialog] = useState(null); // { event } where event is null when adding
  const [deleting, setDeleting] = useState(null);

  const deptName = (id) => {
    const d = (departments.data ?? []).find((x) => x.id === id);
    return d ? t('calendar.scopeOf.department', { code: d.code }) : id;
  };
  const scopeText = (event) =>
    event.scope_department_id
      ? deptName(event.scope_department_id)
      : t('calendar.scopeOf.university');

  const scopeChoices = [
    ...(isSuper ? [{ value: 'university', label: t('calendar.scopeUniversity') }] : []),
    ...choices.map((d) => ({ value: d.id, label: `${d.code} ${d.name}` })),
  ];
  const canManage = (event) =>
    isSuper ||
    (event.scope_department_id && choices.some((c) => c.id === event.scope_department_id));

  const save = (event) => (body) =>
    event ? update.mutateAsync({ id: event.id, ...body }) : create.mutateAsync(body);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('calendar.title')}</h1>
        {scopeChoices.length > 0 && !dialog && (
          <Button type="button" onClick={() => setDialog({ event: null })}>
            {t('calendar.add')}
          </Button>
        )}
      </div>

      {!current && semester.isSuccess && <p className="text-sm">{t('calendar.noSemester')}</p>}

      <div className="flex flex-wrap gap-4">
        <div className="space-y-1.5">
          <label htmlFor="cal-from" className="block text-sm font-medium">
            {t('calendar.from')}
          </label>
          <input
            id="cal-from"
            type="date"
            className={inputClass}
            value={shown.from}
            onChange={(e) => setRange({ ...shown, from: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cal-to" className="block text-sm font-medium">
            {t('calendar.to')}
          </label>
          <input
            id="cal-to"
            type="date"
            className={inputClass}
            value={shown.to}
            onChange={(e) => setRange({ ...shown, to: e.target.value })}
          />
        </div>
      </div>

      {dialog && (
        <EventDialog
          key={dialog.event?.id ?? 'new'}
          event={dialog.event}
          scopeChoices={scopeChoices}
          save={save(dialog.event)}
          onClose={() => setDialog(null)}
        />
      )}

      {deleting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cal-delete-h"
          className="space-y-3 rounded-md border bg-background p-4 shadow-lg"
          onKeyDown={(e) => e.key === 'Escape' && setDeleting(null)}
        >
          <h2 id="cal-delete-h" className="text-lg font-semibold">
            {t('calendar.deleteConfirm.title')}
          </h2>
          <p className="text-sm">
            {t('calendar.deleteConfirm.body', {
              label: deleting.label,
              dates: t('calendar.dates', { from: deleting.from_date, to: deleting.to_date }),
            })}
          </p>
          <FormError error={del.error} />
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(deleting.id, {
                  onSuccess: () => setDeleting(null),
                })
              }
            >
              {t('calendar.deleteConfirm.confirm')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>
              {t('calendar.deleteConfirm.keep')}
            </Button>
          </div>
        </div>
      )}

      {events.isPending && <p>{t('calendar.loading')}</p>}
      {events.isError && (
        <div className="space-y-2">
          <FormError error={events.error} />
          <Button type="button" variant="secondary" onClick={() => events.refetch()}>
            {t('calendar.retry')}
          </Button>
        </div>
      )}
      {events.isSuccess && events.data.length === 0 && <p>{t('calendar.empty')}</p>}
      {events.isSuccess && events.data.length > 0 && (
        <ul className="space-y-3">
          {events.data.map((event) => (
            <li key={event.id} className="space-y-1 rounded-md border p-4 text-sm">
              <p className="font-medium">{event.label}</p>
              <p>
                {t(`calendar.kinds.${event.kind}`)} · {scopeText(event)} ·{' '}
                {t('calendar.dates', { from: event.from_date, to: event.to_date })}
                {event.cutoff_min != null && (
                  <>
                    {' '}
                    · {t('calendar.cutoff')} {minutesToTime(event.cutoff_min)}
                  </>
                )}
              </p>
              {canManage(event) && (
                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="secondary" onClick={() => setDialog({ event })}>
                    {t('calendar.edit')} <span className="sr-only">{event.label}</span>
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setDeleting(event)}>
                    {t('calendar.delete')} <span className="sr-only">{event.label}</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
