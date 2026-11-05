import { Button } from '@/components/ui/button.jsx';
import { formatDhaka } from '@/lib/time';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// CHT-06: the tick marks are decorative; the status word is what screen readers announce.
const GLYPH = { sent: '✓', delivered: '✓✓', seen: '✓✓' };

/** One message. Deleted messages read "message deleted" with no text (CHT-07). */
export function MessageBubble({ message, canDelete, onDelete, onDownload, downloading = false }) {
  if (message.deleted) {
    return (
      <li className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}>
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm italic text-muted-foreground">
          {t('chat.messageDeleted')}
        </p>
      </li>
    );
  }
  return (
    <li className={cn('flex flex-col gap-1', message.mine ? 'items-end' : 'items-start')}>
      {message.file ? (
        <FileCard
          file={message.file}
          mine={message.mine}
          onDownload={onDownload}
          downloading={downloading}
        />
      ) : null}
      {message.body ? (
        <p
          className={cn(
            'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm',
            message.mine ? 'bg-primary text-primary-foreground' : 'bg-secondary',
          )}
        >
          {message.body}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <time dateTime={message.created_at}>{formatDhaka(message.created_at, 'HH:mm')}</time>
        {message.status ? (
          <span>
            <span aria-hidden="true">{GLYPH[message.status]}</span>
            <span className="sr-only">{t(`chat.status.${message.status}`)}</span>
          </span>
        ) : null}
        {canDelete ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(message.id)}>
            {t('chat.delete')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Spec 21: the file bubble. Scanning, ready (download) or removed. Never shown inline. */
function FileCard({ file, mine, onDownload, downloading }) {
  const removed = file.status === 'removed';
  const name = file.name ?? t('chat.file.unnamed');
  return (
    <div
      className={cn(
        'flex max-w-[85%] flex-col gap-1 rounded-lg border p-3 text-sm',
        mine ? 'bg-primary/10' : 'bg-secondary',
      )}
    >
      <p className="break-all font-medium">{removed ? t('chat.file.unnamed') : name}</p>
      {file.size != null && !removed ? (
        <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
      ) : null}
      {file.status === 'scanning' ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t('chat.file.scanning')}
        </p>
      ) : null}
      {removed ? (
        <p role="status" className="text-xs text-destructive">
          {t('chat.file.removed')}
        </p>
      ) : null}
      {file.status === 'ready' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={downloading}
          aria-label={t('chat.file.downloadLabel', { name })}
          onClick={() => onDownload?.(file.id)}
        >
          {t('chat.file.download')}
        </Button>
      ) : null}
    </div>
  );
}

/** Bytes as KB or MB for display. */
export function formatSize(bytes) {
  if (bytes >= 1024 * 1024) {
    return t('chat.file.sizeMb', { value: (bytes / (1024 * 1024)).toFixed(1) });
  }
  return t('chat.file.sizeKb', { value: Math.max(1, Math.round(bytes / 1024)) });
}
