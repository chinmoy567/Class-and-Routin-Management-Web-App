import { t } from '@/lib/i18n';
import { hhmm } from './time.js';

export function SectionPreview({ sections }) {
  return (
    <section aria-labelledby="preview-h" className="space-y-3">
      <h2 id="preview-h" className="text-lg font-semibold">
        {t('imports.preview')}
      </h2>
      {sections.map((s) => (
        <div key={s.key} className="space-y-2 rounded-md border p-3">
          <h3 className="font-medium">
            {s.department_code} {s.level}-{s.term}-{s.letter}
            {s.new && (
              <span className="text-sm text-muted-foreground"> ({t('imports.newSection')})</span>
            )}
          </h3>
          <ul className="space-y-1 text-sm">
            {s.rows.map((r) => (
              <li key={r.row}>
                {t(`imports.day.${r.day}`)} {hhmm(r.start_min)}–{hhmm(r.end_min)} · {r.course_code}{' '}
                · {r.group ?? t('imports.whole')} · {r.room_code} ·{' '}
                {r.tba ? t('imports.tba') : r.teacher_keys.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
