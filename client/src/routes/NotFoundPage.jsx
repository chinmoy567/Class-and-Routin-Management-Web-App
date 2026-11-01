import { Link } from 'react-router';
import { t } from '@/lib/i18n';
import { buttonVariants } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('notFound.body')}</p>
      <Link to="/" className={`${buttonVariants()} mt-4`}>
        {t('notFound.back')}
      </Link>
    </section>
  );
}
