import { t } from '@/lib/i18n';

export function HomePage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('home.intro')}</p>
    </section>
  );
}
