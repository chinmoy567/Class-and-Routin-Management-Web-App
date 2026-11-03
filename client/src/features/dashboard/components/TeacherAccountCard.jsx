import { useId } from 'react';
import { t } from '@/lib/i18n';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';

/** DSH-16: the linked short code and name, or the "not linked yet" notice. */
export function TeacherAccountCard({ teacherLink }) {
  const id = useId();
  if (!teacherLink) return null;
  return (
    <DashboardCard id={id} title={t('dashboard.account')}>
      {teacherLink.linked ? (
        <ul className="space-y-1 text-sm">
          {teacherLink.records.map((r) => (
            <li key={r.short_code}>
              {t('dashboard.linked').replace('{code}', r.short_code).replace('{name}', r.full_name)}
            </li>
          ))}
        </ul>
      ) : (
        <CardMessage>{t('dashboard.notLinked')}</CardMessage>
      )}
    </DashboardCard>
  );
}
