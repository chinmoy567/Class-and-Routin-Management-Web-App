import { t } from '@/lib/i18n';
import { EXAMPLE_NOW_DAY, EXAMPLE_WEEK } from '@/features/landing/sampleData.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

/**
 * The week example: Sunday to Thursday. On a phone each day is a row; from `md` up the days sit
 * side by side in columns. A sample "now" line moves down the middle day. Every item is an example.
 */
export function WeekPreview() {
  return (
    <section data-reveal aria-labelledby="landing-week-title" className="landing-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="landing-week-title" className="text-base font-semibold text-[var(--l-sand)]">
          {t('landing.week.title')}
        </h2>
        <p className="landing-tag">{t('landing.example')}</p>
      </div>

      <ol className="mt-4 grid gap-3 md:grid-cols-5">
        {EXAMPLE_WEEK.map((d) => {
          const isNowDay = d.day === EXAMPLE_NOW_DAY;
          return (
            <li
              key={d.day}
              className="landing-day relative overflow-hidden rounded-md border border-[var(--l-line)] bg-[var(--l-bg)] p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--l-muted)]">
                {DAY_NAMES[d.day]}
              </p>
              <ul className="mt-2 space-y-2">
                {d.slots.map((s) => (
                  <li
                    key={s.title}
                    className="rounded bg-[var(--l-surface)] px-2 py-1.5 text-xs text-[var(--l-sand)]"
                  >
                    <span className="block text-[var(--l-muted)]">
                      {String(Math.floor(s.start)).padStart(2, '0')}:{s.start % 1 ? '30' : '00'}
                    </span>
                    {s.title}
                  </li>
                ))}
              </ul>
              {isNowDay && (
                <span
                  className="landing-now absolute inset-x-0 top-0 h-0.5 bg-[var(--l-brass)]"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">{t('landing.week.note')}</p>
    </section>
  );
}
