import { useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useChatSocket, useConversations } from '@/features/chat/hooks.js';
import { SuspensionBanner } from '@/features/chat/components/SuspensionBanner.jsx';
import { t } from '@/lib/i18n';
import { formatDhaka } from '@/lib/time';
import { cn } from '@/lib/utils';

/** CHT-15: the chat list with unread badges. Removed groups are shown so the appeal can be reached. */
export function ChatListPage() {
  useChatSocket();
  const { data, isPending, error } = useConversations();
  const [permission, setPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  const askForNotifications = async () => {
    setPermission(await Notification.requestPermission());
  };

  if (isPending && !error) return <p>{t('common.loading')}</p>;

  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('chat.title')}</h1>
        <Link to="/chat/new" className={cn(buttonVariants({ size: 'sm' }))}>
          {t('chat.newChat')}
        </Link>
      </div>
      <FormError error={error} />
      <SuspensionBanner />
      <Link to="/chat/blocked" className="inline-block text-sm underline">
        {t('chat.block.title')}
      </Link>

      {permission === 'default' ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
          <span>{t('chat.notifyAsk')}</span>
          <Button type="button" variant="outline" size="sm" onClick={askForNotifications}>
            {t('chat.notifyAllow')}
          </Button>
        </div>
      ) : null}

      {data?.length ? (
        <ul className="divide-y rounded-md border">
          {data.map((c) => (
            <li key={c.id}>
              <Link
                to={`/chat/${c.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-secondary"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name ?? t('chat.unnamed')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.removed
                      ? t('chat.removed.label')
                      : c.closed
                        ? t('chat.closedLabel')
                        : c.type === 'section_group'
                          ? t('chat.groupLabel')
                          : null}
                    {c.last_message_at
                      ? ` · ${formatDhaka(c.last_message_at, 'd MMM, HH:mm')}`
                      : null}
                  </span>
                </span>
                {c.unread > 0 ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    <span aria-hidden="true">{c.unread}</span>
                    <span className="sr-only">{t('chat.unreadCount', { count: c.unread })}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('chat.empty')}</p>
      )}
    </section>
  );
}
