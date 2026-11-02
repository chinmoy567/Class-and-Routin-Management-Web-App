import { Button } from '@/components/ui/button.jsx';
import { t } from '@/lib/i18n';

/** CRD-07: last semester's matching section, with the one-click re-appoint. */
export function LastSemesterCard({ last, editable, working, onReappoint }) {
  if (!last || last.representatives.length === 0) {
    return (
      <section aria-labelledby="rep-last" className="space-y-2">
        <h2 id="rep-last" className="text-lg font-medium">
          {t('representatives.last.title', { semester: last?.semester ?? '—' })}
        </h2>
        <p className="text-sm text-muted-foreground">{t('representatives.last.none')}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="rep-last" className="space-y-2">
      <h2 id="rep-last" className="text-lg font-medium">
        {t('representatives.last.title', { semester: last.semester })}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t('representatives.last.section', { name: last.section.name })}
      </p>
      <ul className="space-y-1">
        {last.representatives.map((r) => (
          <li key={r.role_id} className="text-sm">
            <span className="font-medium">{t(`representatives.${r.role}`)}</span> {r.full_name}
          </li>
        ))}
      </ul>
      {editable && (
        <Button type="button" disabled={working} onClick={onReappoint}>
          {working ? t('representatives.last.working') : t('representatives.last.reappoint')}
        </Button>
      )}
    </section>
  );
}
