import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { t } from '@/lib/i18n';

/**
 * ADM-15: the temporary password is shown once. It lives only in this component's state, and closing the
 * dialog throws it away. The parent must not keep a copy.
 */
export function TempPasswordDialog({ name, password, onClose }) {
  const id = useId();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="w-full max-w-md space-y-4 rounded-lg bg-background p-4 shadow-lg"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {t('admin.students.tempTitle', { name })}
        </h2>
        <p className="text-sm">{t('admin.students.tempShown')}</p>
        <p className="rounded-md border bg-muted px-3 py-2 font-mono text-base tracking-wider break-all">
          {password}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={copy}>
            {copied ? t('admin.students.tempCopied') : t('admin.students.tempCopy')}
          </Button>
          <Button type="button" onClick={onClose}>
            {t('admin.students.tempClose')}
          </Button>
        </div>
      </div>
    </div>
  );
}
