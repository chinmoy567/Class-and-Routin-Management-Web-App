import { Link } from 'react-router';
import { t } from '@/lib/i18n';
import { useReveal } from '../useReveal.js';
import { HeroStatus } from './HeroStatus.jsx';
import { WeekPreview } from './WeekPreview.jsx';
import { FeatureStrip } from './FeatureStrip.jsx';

/**
 * The public landing dashboard at `/` for a signed-out visitor (PRD: Visitor landing dashboard).
 * It shows example data only and needs no session beyond the check that sent the person here.
 */
export function LandingPage() {
  const ref = useReveal();
  return (
    <div ref={ref} className="landing min-h-dvh px-4 pb-12 pt-6 sm:px-8">
      <a
        href="#landing-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--l-brass)] focus:px-3 focus:py-2 focus:text-[var(--l-bg)]"
      >
        {t('nav.skipToContent')}
      </a>

      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <p className="text-base font-semibold tracking-tight text-[var(--l-sand)]">
          {t('app.name')}
        </p>
        <nav aria-label={t('landing.nav')} className="flex gap-2">
          <Link to="/login" className="landing-btn-ghost">
            {t('landing.signIn')}
          </Link>
        </nav>
      </header>

      <main id="landing-main" className="mx-auto mt-10 max-w-5xl space-y-10 sm:mt-16">
        <section className="landing-hero grid gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <div data-reveal className="space-y-5">
            <p className="landing-tag">{t('app.tagline')}</p>
            <h1 className="text-3xl font-semibold leading-tight text-[var(--l-sand)] sm:text-4xl">
              {t('landing.hero.title')}
            </h1>
            <p className="max-w-prose text-base text-[var(--l-muted)]">{t('landing.hero.body')}</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/login" className="landing-btn">
                {t('landing.signIn')}
              </Link>
              <Link to="/signup" className="landing-btn-ghost">
                {t('landing.signUp')}
              </Link>
            </div>
          </div>
          <HeroStatus />
        </section>

        <WeekPreview />
        <FeatureStrip />

        <p className="text-center text-xs text-[var(--l-muted)]">{t('landing.footnote')}</p>
      </main>
    </div>
  );
}
