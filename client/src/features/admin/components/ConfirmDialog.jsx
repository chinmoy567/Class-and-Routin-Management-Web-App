import { useId, useState } from 'react';
import { deactivateBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { t } from '@/lib/i18n';

/**
 * ADM-21: a destructive action waits here until the admin confirms. With `withReason`, the admin must
 * also give a reason (5 to 500 characters, the same rule as the server). Escape and Cancel close it.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  withReason = false,
  reasonLabel = t('admin.students.reason'),
  pending = false,
  error = null,
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const valid = !withReason || deactivateBody.safeParse({ reason }).success;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        className="w-full max-w-md space-y-4 rounded-lg bg-background p-4 shadow-lg"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={`${id}-body`} className="text-sm">
          {body}
        </p>
        {withReason && (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-reason`} className="block text-sm font-medium">
              {reasonLabel}
            </label>
            <textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            {reason.length > 0 && !valid && (
              <p className="text-sm text-destructive">{t('admin.students.reasonError')}</p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} autoFocus>
            {t('admin.confirm.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!valid || pending}
            onClick={() => onConfirm(withReason ? reason.trim() : undefined)}
          >
            {confirmLabel ?? t('admin.confirm.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
