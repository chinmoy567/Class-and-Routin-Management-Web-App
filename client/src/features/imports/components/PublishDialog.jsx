import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

export function PublishDialog({ warnings, publishing, error, onConfirm, onCancel }) {
  const [reviewed, setReviewed] = useState(false);
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-h"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="space-y-3 rounded-md border bg-background p-4 shadow-lg"
    >
      <h2 id="publish-h" ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {t('imports.publishTitle')}
      </h2>
      <p className="text-sm">{t('imports.publishBody')}</p>
      {warnings > 0 && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          {t('imports.reviewed', { count: warnings })}
        </label>
      )}
      <FormError error={error} />
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={publishing || (warnings > 0 && !reviewed)}
          onClick={() => onConfirm(reviewed)}
        >
          {t('imports.confirmPublish')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('imports.cancel')}
        </Button>
      </div>
    </div>
  );
}
