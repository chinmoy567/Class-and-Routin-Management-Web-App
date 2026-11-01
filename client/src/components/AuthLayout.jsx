import { Outlet } from 'react-router';
import { t } from '@/lib/i18n';

/** The centred card used by sign-in, sign-up, recovery and the "step" screens. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t('nav.skipToContent')}
      </a>
      <p className="mb-6 text-lg font-semibold">{t('app.name')}</p>
      <main id="main" className="w-full max-w-sm space-y-6">
        <Outlet />
      </main>
    </div>
  );
}
