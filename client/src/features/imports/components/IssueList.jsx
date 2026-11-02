import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { t } from '@/lib/i18n';

const FILTERS = [
  ['all', 'imports.filterAll'],
  ['error', 'imports.filterErrors'],
  ['warning', 'imports.filterWarnings'],
];

export function IssueList({ issues, canConfirm, onConfirm, confirming }) {
  const [filter, setFilter] = useState('all');
  const shown = issues.filter((i) => (filter === 'all' ? true : i.severity === filter));
  return (
    <section aria-labelledby="issues-h" className="space-y-3">
      <h2 id="issues-h" className="text-lg font-semibold">
        {t('imports.issues')}
      </h2>
      <div role="group" aria-labelledby="issues-h" className="flex flex-wrap gap-2">
        {FILTERS.map(([value, key]) => (
          <Button
            key={value}
            type="button"
            variant={filter === value ? 'default' : 'secondary'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(key)}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('imports.noIssues')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shown.map((issue) => (
            <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <p className="text-sm">
                <strong>{t(`imports.${issue.severity}`)}</strong> ·{' '}
                {t('imports.row', { row: issue.row })}: {issue.message}
                {issue.confirmed && <span> ({t('imports.confirmed')})</span>}
              </p>
              {canConfirm && issue.offer_combined && !issue.confirmed && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={confirming}
                  onClick={() => onConfirm(issue.id)}
                >
                  {t('imports.confirmCombined')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
