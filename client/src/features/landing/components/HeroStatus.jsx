import { t } from '@/lib/i18n';

/** The "live status" example card: a sample "In class" state with a countdown bar that fills. */
export function HeroStatus() {
  return (
    <figure
      data-reveal
      className="landing-card relative overflow-hidden p-5"
      aria-labelledby="landing-status-title"
    >
      <p className="landing-tag">{t('landing.example')}</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="landing-pulse" aria-hidden="true" />
        <p id="landing-status-title" className="text-lg font-semibold text-[var(--l-sand)]">
          {t('landing.status.inClass')}
        </p>
      </div>
      <p className="mt-1 text-sm text-[var(--l-muted)]">{t('landing.status.sample')}</p>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-[var(--l-muted)]">
          <span>{t('landing.status.started')}</span>
          <span>{t('landing.status.endsIn')}</span>
        </div>
        <div
          className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--l-line)]"
          role="presentation"
        >
          <div className="landing-progress h-full rounded-full bg-[var(--l-brass)]" />
        </div>
      </div>
    </figure>
  );
}
