import { CalendarDays } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useMyRoutine, useRoutineSocket } from '@/features/routine/hooks.js';
import { LiveStatusCard } from '@/features/routine/components/LiveStatusCard.jsx';
import { WeekGrid } from '@/features/routine/components/WeekGrid.jsx';
import { DayList } from '@/features/routine/components/DayList.jsx';

function isoDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function MyRoutinePage() {
  const from = isoDate(0);
  const to = isoDate(6);
  const { data, isLoading, isError } = useMyRoutine(from, to);
  useRoutineSocket();

  const routineData = data;
  const groupMissing = routineData?.group_missing;

  if (isLoading) {
    return (
      <section>
        <h1 className="mb-4 flex items-center gap-2 text-2xl font-semibold">
          <CalendarDays className="size-6" aria-hidden="true" />
          {t('routine.title')}
        </h1>
        <p className="text-muted-foreground">{t('routine.loading')}</p>
      </section>
    );
  }

  if (isError || !routineData) {
    return (
      <section>
        <h1 className="mb-4 flex items-center gap-2 text-2xl font-semibold">
          <CalendarDays className="size-6" aria-hidden="true" />
          {t('routine.title')}
        </h1>
        <p className="text-muted-foreground">{t('routine.noSemester')}</p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="mb-4 flex items-center gap-2 text-2xl font-semibold">
        <CalendarDays className="size-6" aria-hidden="true" />
        {t('routine.title')}
      </h1>

      <LiveStatusCard routineData={routineData} />

      {groupMissing && (
        <div className="mb-6 rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm dark:bg-yellow-900/20">
          {t('routine.groupMissing')}
        </div>
      )}

      <div className="hidden md:block">
        <WeekGrid week={routineData.week} today={routineData.today} />
      </div>

      <div className="md:hidden">
        <DayList days={routineData.days} today={routineData.today} />
      </div>
    </section>
  );
}
