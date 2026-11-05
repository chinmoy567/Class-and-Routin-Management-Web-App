import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useCreateReport } from '@/features/chat/hooks.js';
import { FormDialog } from '@/features/chat/components/FormDialog.jsx';
import { t } from '@/lib/i18n';

// SAF-04: the five reasons, in the order the server lists them.
export const REPORT_CATEGORIES = ['harassment', 'spam', 'inappropriate', 'impersonation', 'other'];

/**
 * SAF-04: report a message (`messageId` given) or a person. The admin of the person's department
 * reviews it; the reporter is never told the outcome.
 */
export function ReportDialog({ targetUserId, targetName, messageId = null, onClose }) {
  const id = useId();
  const report = useCreateReport();
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const title = messageId
    ? t('chat.report.messageTitle')
    : t('chat.report.title').replace('{name}', targetName);

  const submit = async (event) => {
    event.preventDefault();
    try {
      await report.mutateAsync({
        target_user_id: targetUserId,
        ...(messageId && { message_id: messageId }),
        category,
        ...(note.trim() && { note: note.trim() }),
      });
      setSent(true);
    } catch {
      // The error is shown on the form by FormError.
    }
  };

  return (
    <FormDialog title={title} onClose={onClose}>
      {sent ? (
        <div className="space-y-4">
          <p role="status" className="text-sm">
            {t('chat.report.sent')}
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              {t('chat.report.done')}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('chat.report.reasonLabel')}</legend>
            {REPORT_CATEGORIES.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${id}-category`}
                  value={c}
                  checked={category === c}
                  onChange={() => setCategory(c)}
                  className="size-4"
                />
                {t(`chat.report.categories.${c}`)}
              </label>
            ))}
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-note`} className="block text-sm font-medium">
              {t('chat.report.noteLabel')}
            </label>
            <textarea
              id={`${id}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              aria-describedby={`${id}-hint`}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {t('chat.report.noteHint')}
            </p>
          </div>
          <FormError error={report.error} />
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('chat.report.cancel')}
            </Button>
            <Button type="submit" disabled={!category || report.isPending}>
              {t('chat.report.submit')}
            </Button>
          </div>
        </form>
      )}
    </FormDialog>
  );
}
