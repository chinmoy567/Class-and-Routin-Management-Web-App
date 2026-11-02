import { t } from '@/lib/i18n';

/** The readiness hint: every section with its CR status. Status is text, not colour alone. */
export function SectionReadinessList({ sections, selectedId, onSelect }) {
  const missing = sections.filter((s) => !s.has_cr).length;
  return (
    <section aria-labelledby="rep-ready" className="space-y-2">
      <h2 id="rep-ready" className="text-lg font-medium">
        {t('representatives.readiness')}
      </h2>
      {sections.length === 0 ? (
        <p className="text-sm">{t('representatives.noSections')}</p>
      ) : (
        <p role="status" className="text-sm">
          {missing
            ? t('representatives.missingHint', { count: missing })
            : t('representatives.allReady')}
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {sections.map((s) => (
          <li key={s.section_id}>
            <button
              type="button"
              aria-pressed={selectedId === s.section_id}
              aria-label={t('representatives.open', { name: s.name })}
              onClick={() => onSelect(s.section_id)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm aria-pressed:border-primary"
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-xs">
                {s.has_cr ? t('representatives.hasCr') : t('representatives.noCr')} ·{' '}
                {t('representatives.dcrCount', { count: s.dcr_count })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
