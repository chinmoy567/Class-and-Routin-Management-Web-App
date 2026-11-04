import { CalendarDays } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useMyRoutine, useRoutineSocket, useLiveStatus } from '@/features/routine/hooks.js';
import { LiveStatusCard } from '@/features/routine/components/LiveStatusCard.jsx';
import { WeekGrid } from '@/features/routine/components/WeekGrid.jsx';
import { DayList, SlotItem } from '@/features/routine/components/DayList.jsx';
import { dayOn } from '@/features/routine/utils.js';

/** Date arithmetic on a YYYY-MM-DD string the server gave us. No clock is read here. */
function addDaysIso(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function MyRoutinePage() {
  // RTN-06, CLAUDE.md time rule: the first request takes the server's default window, which says
  // what today is in Asia/Dhaka. The week is then asked for from that day, so the device clock
  // never picks the dates.
  const first = useMyRoutine(undefined, undefined);
  const today = first.data?.today;
  const week = useMyRoutine(today, today ? addDaysIso(today, 6) : undefined, {
    enabled: Boolean(today),
  });
  useRoutineSocket();

  const routineData = week.data ?? first.data;
  const status = useLiveStatus(routineData);
  const runningSlotId =
    status?.kind === 'in_class' || status?.kind === 'teaching' ? status.slot?.slot_id : null;

  if (first.isLoading) {
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

  if (first.isError || !routineData) {
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

  const groupMissing = routineData.group_missing;
  const todayDay = dayOn(routineData.days, routineData.today);

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

      <section aria-label={t('routine.todayClasses')} className="mb-6 hidden md:block">
        <h2 className="mb-2 text-lg font-semibold">{t('routine.todayClasses')}</h2>
        {todayDay?.slots?.length ? (
          <ul className="space-y-2">
            {todayDay.slots.map((slot) => (
              <SlotItem key={slot.slot_id} slot={slot} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('routine.noSlotsToday')}</p>
        )}
      </section>

      <div className="hidden md:block">
        <WeekGrid week={routineData.week} today={routineData.today} runningSlotId={runningSlotId} />
      </div>

      <div className="md:hidden">
        <DayList days={routineData.days} today={routineData.today} />
      </div>
    </section>
  );
}
