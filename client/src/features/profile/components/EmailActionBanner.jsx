import { Link } from 'react-router';
import { useMe } from '@/features/auth/hooks.js';
import { t } from '@/lib/i18n';

/** PRF-06: shown until the bouncing email address is changed. */
export function EmailActionBanner() {
  const { data: me } = useMe();
  if (!me?.email_action_required) return null;
  return (
    <div role="alert" className="border-b border-destructive bg-destructive/10 px-4 py-3 text-sm">
      <p className="font-medium">{t('emailBanner.title')}</p>
      <p>
        {t('emailBanner.body')}{' '}
        <Link to="/profile#email" className="font-medium underline">
          {t('emailBanner.action')}
        </Link>
      </p>
    </div>
  );
}
