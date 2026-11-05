import { useId } from 'react';
import { Link } from 'react-router';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import { useUnread } from '@/features/chat/hooks.js';
import { t } from '@/lib/i18n';

/** CHT-15: the unread total on the dashboard, with a link to the chat list. */
export function ChatUnreadCard() {
  const id = useId();
  const { data, isPending, isError } = useUnread();
  let message;
  if (isPending) message = <CardMessage>{t('common.loading')}</CardMessage>;
  else if (isError) message = <CardMessage>{t('chat.dashboard.error')}</CardMessage>;
  else if (!data?.total) message = <CardMessage>{t('chat.dashboard.none')}</CardMessage>;
  else
    message = <p className="text-sm">{t('chat.dashboard.total').replace('{count}', data.total)}</p>;

  return (
    <DashboardCard id={id} title={t('chat.dashboard.title')}>
      {message}
      <Link to="/chat" className="mt-3 inline-block text-sm underline">
        {t('chat.dashboard.open')}
      </Link>
    </DashboardCard>
  );
}
