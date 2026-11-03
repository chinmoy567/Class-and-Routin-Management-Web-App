import { useId } from 'react';
import { t } from '@/lib/i18n';
import { fmtMin } from '@/features/routine/utils.js';
import { SlotItem } from '@/features/routine/components/DayList.jsx';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';
import { todayView } from '../utils.js';

/** DSH-06 (students) and DSH-12 (teachers): today's classes in time order, then a preview. */
export function TodayCard({ routine, routineState, status, isTeacher }) {
  const id = useId();
  const { slots, tomorrow, next } = todayView({ routine, status, isTeacher });

  let body;
  if (routineState === 'loading') {
    body = <CardMessage>{t('dashboard.routineLoading')}</CardMessage>;
  } else if (routineState === 'error' || !routine?.today) {
    body = <CardMessage>{t('dashboard.routineError')}</CardMessage>;
  } else {
    body = (
      <>
        {slots.length ? (
          <ul className="space-y-2">
            {slots.map((slot) => (
              <SlotItem key={slot.slot_id} slot={slot} />
            ))}
          </ul>
        ) : (
          <CardMessage>{t('dashboard.noClassesToday')}</CardMessage>
        )}
        {tomorrow && (
          <p className="mt-3 text-sm">
            {t('dashboard.tomorrowFirst')
              .replace('{time}', fmtMin(tomorrow.start_min))
              .replace('{course}', tomorrow.course_code)}
          </p>
        )}
        {next && (
          <p className="mt-3 text-sm">
            {t('dashboard.nextTeachingDay')
              .replace('{day}', next.date)
              .replace('{time}', fmtMin(next.slot.start_min))
              .replace('{course}', next.slot.course_code)}
          </p>
        )}
      </>
    );
  }

  return (
    <DashboardCard id={id} title={t('dashboard.today')}>
      {body}
    </DashboardCard>
  );
}
