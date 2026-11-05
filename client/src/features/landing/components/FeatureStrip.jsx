import { t } from '@/lib/i18n';

const FEATURES = [
  { key: 'routine', icon: '01' },
  { key: 'status', icon: '02' },
  { key: 'rooms', icon: '03' },
  { key: 'calendar', icon: '04' },
];

/** What the app does, in four short cards. They describe features and show no data. */
export function FeatureStrip() {
  return (
    <section aria-labelledby="landing-features-title" className="space-y-3">
      <h2 id="landing-features-title" className="text-base font-semibold text-[var(--l-sand)]">
        {t('landing.features.title')}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f, i) => (
          <li
            key={f.key}
            data-reveal
            style={{ transitionDelay: `${i * 80}ms` }}
            className="landing-card flex gap-4 p-4"
          >
            <span className="landing-index" aria-hidden="true">
              {f.icon}
            </span>
            <div>
              <p className="font-semibold text-[var(--l-sand)]">
                {t(`landing.features.${f.key}.title`)}
              </p>
              <p className="mt-1 text-sm text-[var(--l-muted)]">
                {t(`landing.features.${f.key}.body`)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
