import { useId } from 'react';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import { LiveStatusCard } from '@/features/routine/components/LiveStatusCard.jsx';
import { WeekGrid } from '@/features/routine/components/WeekGrid.jsx';
import { DayList } from '@/features/routine/components/DayList.jsx';
import { t } from '@/lib/i18n';

/**
 * CRD-DSH-05, CRD-DSH-06: the section's routine with its live status, then each group's live status
 * on its own. Live status ticks by itself, using the same rules as the student's status.
 */
export function SectionRoutineCard({ routine }) {
  const id = useId();
  if (!routine?.section) {
    return (
      <DashboardCard id={id} title={t('cr.routine.heading')}>
        <CardMessage>{t('cr.routine.loading')}</CardMessage>
      </DashboardCard>
    );
  }
  const { section, groups } = routine;
  return (
    <DashboardCard id={id} title={t('cr.routine.heading')}>
      <h3 className="mb-1 text-sm font-medium">{t('cr.routine.sectionLive')}</h3>
      <LiveStatusCard routineData={section} />
      <div className="hidden md:block">
        <WeekGrid week={section.week} today={section.today} />
      </div>
      <div className="md:hidden">
        <DayList days={section.days} today={section.today} />
      </div>

      {groups.map((g) => (
        <div key={g.id} className="mt-4 space-y-2 border-t pt-3">
          <h3 className="text-sm font-medium">
            {t('cr.routine.group').replace('{group}', g.label)}
          </h3>
          <LiveStatusCard routineData={g.routine} />
          <div className="md:hidden">
            <DayList days={g.routine.days} today={g.routine.today} />
          </div>
        </div>
      ))}
    </DashboardCard>
  );
}
