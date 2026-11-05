import { useMe } from '@/features/auth/hooks.js';
import { formatDhaka } from '@/lib/time';
import { t } from '@/lib/i18n';

/**
 * SAF-10: shown to a user whose sending is suspended. Reading still works, so the banner says so.
 * The end time comes from the account (`chat_suspended_until`).
 */
export function SuspensionBanner() {
  const { data } = useMe();
  const until = data?.user?.chat_suspended_until ? new Date(data.user.chat_suspended_until) : null;
  if (!until || until.getTime() <= Date.now()) return null;
  return (
    <div role="status" className="rounded-md border border-destructive p-3 text-sm">
      <p className="font-medium">{t('chat.suspension.bannerTitle')}</p>
      <p>
        {t('chat.suspension.banner').replace('{until}', formatDhaka(until, 'd MMM yyyy, HH:mm'))}
      </p>
    </div>
  );
}
