import { t } from '@/lib/i18n';
import { useMyRoutine, useRoutineSocket, useLiveStatus } from '@/features/routine/hooks.js';
import { useDashboard, useDashboardSocket } from '../hooks.js';
import { dhakaDate } from '../utils.js';
import { StatusCard } from './StatusCard.jsx';
import { TodayCard } from './TodayCard.jsx';
import { WeekCard } from './WeekCard.jsx';
import { NoticesCard } from './NoticesCard.jsx';
import { RoomsCard } from './RoomsCard.jsx';
import { SectionCard } from './SectionCard.jsx';
import { RemindersCard } from './RemindersCard.jsx';
import { SectionsTaughtCard } from './SectionsTaughtCard.jsx';
import { TeacherAccountCard } from './TeacherAccountCard.jsx';

function SummaryError({ onRetry }) {
  return (
    <div role="alert" className="space-y-2">
      <p>{t('dashboard.error')}</p>
      <button type="button" onClick={onRetry} className="min-h-11 rounded-md border px-3 text-sm">
        {t('dashboard.retry')}
      </button>
    </div>
  );
}

/** The cards of a student or teacher, in the priority order of DSH-03. Absent cards are unreleased. */
function Cards({ d, kind, routine, routineState, status }) {
  const isTeacher = kind === 'teacher';
  return (
    <>
      <StatusCard status={status} />
      <TodayCard
        routine={routine.data}
        routineState={routineState}
        status={status}
        isTeacher={isTeacher}
      />
      {d.upcoming_events && <NoticesCard events={d.upcoming_events} />}
      {d.free_now && <RoomsCard freeNow={d.free_now} isTeacher={isTeacher} />}
      <WeekCard routine={routine.data} routineState={routineState} />

      {isTeacher ? (
        <>
          {d.sections_taught && <SectionsTaughtCard sections={d.sections_taught} />}
          {d.teacher_link && <TeacherAccountCard teacherLink={d.teacher_link} />}
          {d.reminders && <RemindersCard reminders={d.reminders} />}
        </>
      ) : (
        <>
          {d.section && (
            <SectionCard
              section={d.section}
              representatives={d.representatives}
              courses={d.courses}
            />
          )}
          {d.reminders && <RemindersCard reminders={d.reminders} isStudent />}
        </>
      )}
    </>
  );
}

/**
 * DSH-01 to DSH-16: the home page of an active student or teacher. The title always shows; the
 * cards stack in one column in the priority order of DSH-03.
 */
export function DashboardPage({ kind }) {
  const dash = useDashboard();
  // The routine is loaded in parallel with the summary (DSH-01); the window is in Asia/Dhaka.
  const routine = useMyRoutine(dhakaDate(0), dhakaDate(6));
  useRoutineSocket();
  useDashboardSocket();
  const status = useLiveStatus(routine.data);

  let body;
  if (dash.isPending) {
    body = <p className="text-muted-foreground">{t('dashboard.loading')}</p>;
  } else if (dash.isError) {
    body = <SummaryError onRetry={() => dash.refetch()} />;
  } else {
    const routineState = routine.isError ? 'error' : routine.data ? 'ready' : 'loading';
    body = (
      <Cards
        d={dash.data}
        kind={kind}
        routine={routine}
        routineState={routineState}
        status={status}
      />
    );
  }

  return (
    <section aria-labelledby="dashboard-title" className="space-y-4">
      <h1 id="dashboard-title" className="text-2xl font-semibold">
        {t('dashboard.title')}
      </h1>
      {body}
    </section>
  );
}
