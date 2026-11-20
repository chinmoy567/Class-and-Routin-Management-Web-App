import { Link } from 'react-router';
import { CampusScene } from '@/components/CampusScene.jsx';
import { t } from '@/lib/i18n';
import { useReveal } from '../useReveal.js';
import { HeroStatus } from './HeroStatus.jsx';
import { WeekPreview } from './WeekPreview.jsx';
import { FeatureStrip } from './FeatureStrip.jsx';

/**
 * The public landing page at `/` for a signed-out visitor (PRD: Visitor landing dashboard).
 * A campus scene on one side, the routine on the other. It shows example data only and needs no
 * session beyond the check that sent the person here.
 */
export function LandingPage() {
  const ref = useReveal();
  return (
    <div ref={ref} className="landing lg:grid lg:grid-cols-[minmax(340px,38%)_1fr]">
      <a
        href="#landing-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t('nav.skipToContent')}
      </a>

      <div className="h-48 overflow-hidden sm:h-64 lg:sticky lg:top-0 lg:h-dvh">
        <CampusScene className="size-full" />
      </div>

      <div className="px-4 pb-16 pt-6 sm:px-10 lg:px-16 lg:pt-10">
        <header className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <p className="font-serif text-lg">{t('app.name')}</p>
          <nav aria-label={t('landing.nav')}>
            <Link to="/login" className="serif-link text-lg">
              {t('landing.signIn')}
            </Link>
          </nav>
        </header>

        <main id="landing-main" className="mx-auto mt-12 max-w-3xl space-y-14 lg:mt-24">
          <section className="grid gap-10">
            <div data-reveal className="space-y-6">
              <p className="landing-tag">{t('app.tagline')}</p>
              <h1 className="text-4xl leading-[1.08] sm:text-5xl lg:text-6xl">
                {t('landing.hero.title')}
              </h1>
              <p className="max-w-prose text-lg text-[var(--l-muted)]">{t('landing.hero.body')}</p>
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

          <p className="text-sm text-[var(--l-muted)]">{t('landing.footnote')}</p>
        </main>
      </div>
    </div>
  );
}
