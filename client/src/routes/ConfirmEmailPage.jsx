import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useConfirmEmailChange } from '@/features/profile/hooks.js';
import { t } from '@/lib/i18n';

/** The landing page for the link sent to the new address (PRF-05). */
export function ConfirmEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const confirm = useConfirmEmailChange();
  const started = useRef(false);

  const { mutate } = confirm;
  useEffect(() => {
    if (token && !started.current) {
      started.current = true; // a link works once, so never send it twice
      mutate(token);
    }
  }, [token, mutate]);

  if (!token) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('profile.confirmEmail.invalidTitle')}</h1>
        <p>{t('profile.confirmEmail.missing')}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-live="polite">
      <h1 className="text-2xl font-semibold">{t('profile.confirmEmail.title')}</h1>
      {confirm.isSuccess && (
        <>
          <p>{t('profile.confirmEmail.done')}</p>
          <Link to="/profile" className="font-medium underline">
            {t('profile.confirmEmail.toProfile')}
          </Link>
        </>
      )}
      {confirm.isError && <FormError error={confirm.error} />}
      {confirm.isPending && <p>{t('profile.confirmEmail.working')}</p>}
    </section>
  );
}
