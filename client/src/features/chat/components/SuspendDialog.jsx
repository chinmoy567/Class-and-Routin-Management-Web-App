import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { FormDialog } from '@/features/chat/components/FormDialog.jsx';
import { useLiftSuspension, useSuspend, useSuspensions } from '@/features/chat/hooks.js';
import { t } from '@/lib/i18n';
import { formatDhaka } from '@/lib/time';

// SAF-10: the lengths the admin can choose, from 1 hour to 90 days.
const LENGTHS = ['1', '6', '24', '72', '168', '720', '2160'];

/**
 * SAF-10: suspend a person from sending messages, or lift a running suspension. Reading stays on.
 * The server refuses the admins of other departments (SAF-11).
 */
export function SuspendDialog({ userId, name, onClose }) {
  const id = useId();
  const active = useSuspensions(userId);
  const suspend = useSuspend();
  const lift = useLiftSuspension();
  const [hours, setHours] = useState('24');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(null);
  const valid = reason.trim().length > 0 && reason.trim().length <= 500;

  return (
    <FormDialog title={t('chat.suspension.title').replace('{name}', name)} onClose={onClose}>
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">{t('chat.suspension.active')}</h3>
        {active.data?.length ? (
          <ul className="space-y-2">
            {active.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {t('chat.suspension.until').replace(
                    '{until}',
                    formatDhaka(s.until, 'd MMM yyyy, HH:mm'),
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={lift.isPending}
                  onClick={() => lift.mutate(s.id, { onSuccess: () => setDone('lifted') })}
                >
                  {t('chat.suspension.lift')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('chat.suspension.none')}</p>
        )}
        <FormError error={lift.error} />

        <form
          className="space-y-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            suspend.mutate(
              { user_id: userId, hours: Number(hours), reason: reason.trim() },
              { onSuccess: () => setDone('suspended') },
            );
          }}
        >
          <label htmlFor={`${id}-hours`} className="block text-sm font-medium">
            {t('chat.suspension.length')}
          </label>
          <select
            id={`${id}-hours`}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
          >
            {LENGTHS.map((h) => (
              <option key={h} value={h}>
                {t(`chat.suspension.options.${h}`)}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-reason`} className="block text-sm font-medium">
            {t('chat.suspension.reason')}
          </label>
          <textarea
            id={`${id}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            aria-describedby={`${id}-hint`}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {t('chat.suspension.reasonHint')}
          </p>
          <FormError error={suspend.error} />
          {done ? (
            <p role="status" className="text-sm">
              {done === 'lifted' ? t('chat.suspension.lifted') : t('chat.suspension.suspended')}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('chat.report.cancel')}
            </Button>
            <Button type="submit" disabled={!valid || suspend.isPending}>
              {t('chat.suspension.submit')}
            </Button>
          </div>
        </form>
      </div>
    </FormDialog>
  );
}
