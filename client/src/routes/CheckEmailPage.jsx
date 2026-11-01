import { Link } from 'react-router';
import { t } from '@/lib/i18n';

export function CheckEmailPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('auth.checkEmail.title')}</h1>
      <p>{t('auth.checkEmail.body')}</p>
      <Link to="/login" className="font-medium underline">
        {t('auth.checkEmail.toSignIn')}
      </Link>
    </section>
  );
}
