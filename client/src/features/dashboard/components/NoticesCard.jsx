import { useId } from 'react';
import { t } from '@/lib/i18n';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';

/** DSH-07, DSH-15: university and department events in the next 14 days. */
export function NoticesCard({ events }) {
  const id = useId();
  return (
    <DashboardCard id={id} title={t('dashboard.notices')}>
      {!events?.length ? (
        <CardMessage>{t('dashboard.noNotices')}</CardMessage>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="font-medium">{e.label}</span>{' '}
              <span className="text-muted-foreground">
                {t(`dashboard.eventKinds.${e.kind}`)} · {e.from_date}
                {e.to_date !== e.from_date ? ` – ${e.to_date}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
