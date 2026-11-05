import { Button, buttonVariants } from '@/components/ui/button.jsx';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { formatSize } from '@/features/chat/components/MessageBubble.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';

// Spec 21, FIL-01, FIL-03: the same limits as the server, checked early for a quick message. The
// server checks the real content again and has the final word.
export const FILE_MAX_BYTES = 5 * 1024 * 1024;
export const FILE_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.gif,.webp';
const ALLOWED_NAME = /\.(pdf|docx?|pptx?|xlsx?|txt|jpe?g|png|gif|webp)$/i;

/** The problem with a chosen file, as a translated message, or null when it looks fine. */
export function fileProblem(file) {
  if (file.size > FILE_MAX_BYTES) return t('chat.file.tooLarge');
  if (!ALLOWED_NAME.test(file.name)) return t('chat.file.notAllowed');
  return null;
}

/**
 * The attach control above the message box. Shows the chosen file, lets it be removed, and shows
 * upload progress while the file goes up. The text box below is the caption.
 */
export function FileComposer({ file, onChange, error, progress, uploading }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="chat-file"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'cursor-pointer')}
        >
          {t('chat.file.attach')}
        </label>
        <input
          id="chat-file"
          type="file"
          accept={FILE_ACCEPT}
          className="sr-only"
          aria-label={t('chat.file.attachLabel')}
          disabled={uploading}
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            event.target.value = '';
            onChange(chosen);
          }}
        />
        {file ? (
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={uploading}
              aria-label={t('chat.file.removeLabel', { name: file.name })}
              onClick={() => onChange(null)}
            >
              {t('chat.file.remove')}
            </Button>
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {uploading ? (
        <div className="space-y-1">
          <progress
            className="h-2 w-full"
            value={Math.round((progress ?? 0) * 100)}
            max={100}
            aria-label={t('chat.file.progressLabel')}
          />
          <p className="text-xs text-muted-foreground">
            {t('chat.file.uploading', { percent: Math.round((progress ?? 0) * 100) })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// Spec 21: the file codes have wording of their own (the shared text for these codes is about photos).
const FILE_ERROR_CODES = [
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_TOO_LARGE',
  'FILE_NOT_READY',
  'LINK_EXPIRED',
  'GROUP_CLOSED',
  'STATE_NOT_ALLOWED',
];

/** A failed file request as one sentence, with the chat file wording where there is one. */
export function FileError({ error }) {
  if (!error) return null;
  if (FILE_ERROR_CODES.includes(error.code)) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t(`chat.file.errors.${error.code}`)}
      </p>
    );
  }
  return <FormError error={error} />;
}
