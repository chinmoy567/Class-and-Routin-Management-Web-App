import { Link, Outlet } from 'react-router';
import { CampusScene } from '@/components/CampusScene.jsx';
import { t } from '@/lib/i18n';

/** Sign-in, sign-up, recovery and the "step" screens: a campus scene beside a quiet form on paper. */
export function AuthLayout() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(340px,42%)_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t('nav.skipToContent')}
      </a>
      <div className="h-32 overflow-hidden sm:h-48 lg:sticky lg:top-0 lg:h-dvh">
        <CampusScene className="size-full" />
      </div>
      <div className="flex flex-col px-4 pb-12 pt-6 sm:px-10 lg:px-20 lg:pt-10">
        <Link to="/" className="serif-link w-fit text-lg">
          {t('app.name')}
        </Link>
        <main id="main" className="my-auto w-full max-w-sm space-y-6 py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
