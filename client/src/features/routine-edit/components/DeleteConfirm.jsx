import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

export function DeleteConfirm({ slot, deleting, error, onConfirm, onCancel }) {
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-h"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="space-y-3 rounded-md border bg-background p-4 shadow-lg"
    >
      <h2 id="delete-h" ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {t('routineEdit.deleteConfirm.title')}
      </h2>
      <p className="text-sm">
        {t('routineEdit.deleteConfirm.body', {
          course: slot.course_code,
          day: t(`routineEdit.days.${slot.day_of_week}`),
          start: slot.start,
          end: slot.end,
        })}
      </p>
      <FormError error={error} />
      <div className="flex gap-2">
        <Button type="button" disabled={deleting} onClick={onConfirm}>
          {t('routineEdit.deleteConfirm.confirm')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('routineEdit.deleteConfirm.cancel')}
        </Button>
      </div>
    </div>
  );
}
