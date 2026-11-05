import { Button } from '@/components/ui/button.jsx';
import { formatDhaka } from '@/lib/time';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// CHT-06: the tick marks are decorative; the status word is what screen readers announce.
const GLYPH = { sent: '✓', delivered: '✓✓', seen: '✓✓' };

/** One message. Deleted messages read "message deleted" with no text (CHT-07). */
export function MessageBubble({ message, canDelete, onDelete }) {
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
      <p
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm',
          message.mine ? 'bg-primary text-primary-foreground' : 'bg-secondary',
        )}
      >
        {message.body}
      </p>
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
