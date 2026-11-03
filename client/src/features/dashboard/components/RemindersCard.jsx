import { useId } from 'react';
import { t } from '@/lib/i18n';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';

/** DSH-10, DSH-16: one line for each thing on the owner's profile that needs attention. */
export function RemindersCard({ reminders, isStudent }) {
  const id = useId();
  if (!reminders) return null;

  const lines = [];
  if (isStudent && reminders.semester_badge) {
    const { semester, confirmed } = reminders.semester_badge;
    const key = confirmed ? 'dashboard.semesterConfirmed' : 'dashboard.semesterNotConfirmed';
    lines.push(t(key).replace('{semester}', semester));
  }
  if (isStudent && reminders.group_missing) lines.push(t('dashboard.groupMissing'));
  if (reminders.email === 'unverified') lines.push(t('dashboard.emailUnverified'));
  if (reminders.email === 'bouncing') lines.push(t('dashboard.emailBouncing'));
  if (reminders.phone_missing) lines.push(t('dashboard.phoneMissing'));
  if (reminders.photo_missing) lines.push(t('dashboard.photoMissing'));

  return (
    <DashboardCard id={id} title={t('dashboard.reminders')}>
      {lines.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <CardMessage>{t('dashboard.noReminders')}</CardMessage>
      )}
    </DashboardCard>
  );
}
