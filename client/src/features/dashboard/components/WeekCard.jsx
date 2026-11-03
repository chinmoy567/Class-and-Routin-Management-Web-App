import { useId } from 'react';
import { t } from '@/lib/i18n';
import { WeekGrid } from '@/features/routine/components/WeekGrid.jsx';
import { DayList } from '@/features/routine/components/DayList.jsx';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';

/** DSH-06, DSH-12: the Sunday-to-Thursday grid; a day-by-day list on phones (RTN-18). */
export function WeekCard({ routine, routineState }) {
  const id = useId();

  let body;
  if (routineState === 'loading') {
    body = <CardMessage>{t('dashboard.routineLoading')}</CardMessage>;
  } else if (routineState === 'error' || !routine?.today) {
    body = <CardMessage>{t('dashboard.routineError')}</CardMessage>;
  } else {
    body = (
      <>
        <div className="hidden md:block">
          <WeekGrid week={routine.week} today={routine.today} />
        </div>
        <div className="md:hidden">
          <DayList days={routine.days} today={routine.today} />
        </div>
      </>
    );
  }

  return (
    <DashboardCard id={id} title={t('dashboard.week')}>
      {body}
    </DashboardCard>
  );
}
