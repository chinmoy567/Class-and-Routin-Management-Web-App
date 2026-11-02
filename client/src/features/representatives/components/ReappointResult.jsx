import { t } from '@/lib/i18n';

const reasonText = (code) => {
  const key = `representatives.result.reason.${code}`;
  return t(key) === key ? code : t(key);
};

/** CRD-07: who was assigned, and who was skipped and why. */
export function ReappointResult({ result }) {
  return (
    <section aria-labelledby="rep-result" role="status" className="space-y-2 rounded-md border p-3">
      <h2 id="rep-result" className="text-lg font-medium">
        {t('representatives.result.title')}
      </h2>
      {result.assigned.length === 0 && result.skipped.length === 0 && (
        <p className="text-sm">{t('representatives.result.none')}</p>
      )}
      {result.assigned.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">{t('representatives.result.assigned')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {result.assigned.map((p) => (
              <li key={p.user_id}>
                {p.full_name} ({t(`representatives.${p.role}`)})
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.skipped.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">{t('representatives.result.skipped')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {result.skipped.map((p) => (
              <li key={p.user_id}>
                {p.full_name} ({t(`representatives.${p.role}`)}): {reasonText(p.reason)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
