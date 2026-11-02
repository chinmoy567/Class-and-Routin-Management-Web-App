import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { PERIODS } from '@crm/shared';
import { t } from '@/lib/i18n';
import { useMyRoutine, useRoutineSocket, useLiveStatus } from '@/features/routine/hooks.js';
import { slotForPeriod, fmtMin } from '@/features/routine/utils.js';

function isoDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const DAY_LABEL_KEYS = [
  'routine.daySun',
  'routine.dayMon',
  'routine.dayTue',
  'routine.dayWed',
  'routine.dayThu',
];

function LiveStatusCard({ routineData }) {
  const status = useLiveStatus(routineData);
  if (!status) return null;

  const { kind, slot, ends_at, next } = status;
  let headline = '';
  let sub = '';
  let accent = 'bg-secondary';

  if (kind === 'in_class') {
    headline = t('routine.statusInClass');
    if (slot) {
      const endsTime = fmtMin(ends_at ?? slot.effective_end_min);
      sub = `${slot.course_code} · ${slot.room_code ?? ''} · ${t('routine.countdownEndsIn').replace('{time}', endsTime)}`;
    }
    accent = 'bg-green-100 dark:bg-green-900/30';
  } else if (kind === 'teaching') {
    headline = t('routine.statusTeaching');
    if (slot) {
      const endsTime = fmtMin(ends_at ?? slot.effective_end_min);
      sub = `${slot.course_code} · ${slot.room_code ?? ''} · ${t('routine.countdownEndsIn').replace('{time}', endsTime)}`;
    }
    accent = 'bg-blue-100 dark:bg-blue-900/30';
  } else if (kind === 'free') {
    headline = t('routine.statusFree');
    if (next) {
      sub = t('routine.countdownNextIn')
        .replace('{course}', next.course_code ?? '')
        .replace('{time}', fmtMin(next.start_min));
    }
  } else if (kind === 'event') {
    headline = t('routine.statusEvent').replace('{label}', status.label ?? '');
  } else if (kind === 'classes_over') {
    headline = t('routine.statusClassesOver').replace('{label}', status.label ?? '');
  } else if (kind === 'no_classes_today') {
    headline = t('routine.statusNoClasses');
  } else if (kind === 'no_semester') {
    headline = t('routine.statusNoSemester');
  }

  return (
    <div className={`rounded-lg p-4 mb-6 ${accent}`}>
      <p className="font-semibold text-base">{headline}</p>
      {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function pickShortCode(tc) {
  return tc.short_code ?? tc.full_name;
}

function SlotCell({ slot }) {
  if (!slot) return null;
  const raw = slot.teachers?.length ? slot.teachers.map(pickShortCode).join(', ') : null;
  const teachers = raw ?? t('routine.tba');
  const cancelled = slot.status === 'cancelled';
  const cellClass = cancelled
    ? 'rounded px-1 py-1 text-xs leading-tight opacity-40 line-through'
    : 'rounded px-1 py-1 text-xs leading-tight bg-primary/10';
  return (
    <div className={cellClass}>
      <div className="font-medium">{slot.course_code}</div>
      {slot.room_code && <div className="text-muted-foreground">{slot.room_code}</div>}
      <div className="text-muted-foreground">{teachers}</div>
    </div>
  );
}

/** Day of week (0 = Sunday) for an institution date string from the server. */
const dowOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

function WeekGrid({ week, today }) {
  if (!week?.length) {
    return <p className="text-muted-foreground text-sm">{t('routine.noSlotsToday')}</p>;
  }

  const todayDow = dowOf(today);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse min-w-[600px]">
        <thead>
          <tr>
            <th className="border px-2 py-1 bg-muted text-left w-24">{t('routine.week')}</th>
            {DAY_LABEL_KEYS.map((key, i) => {
              const thClass = `border px-2 py-1 text-center ${todayDow === i ? 'bg-primary/10 font-bold' : 'bg-muted'}`;
              return (
                <th key={i} className={thClass}>
                  {t(key)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((period) => (
            <tr key={period.start_min}>
              <td className="border px-2 py-1 bg-muted text-muted-foreground whitespace-nowrap">
                {period.label}
              </td>
              {Array.from({ length: 5 }, (_, dow) => {
                const daySlots = week.find((d) => d.day_of_week === dow)?.slots ?? [];
                const slot = slotForPeriod(daySlots, period.start_min);
                const tdClass = `border px-1 py-1 align-top ${todayDow === dow ? 'bg-primary/5' : ''}`;
                return (
                  <td key={dow} className={tdClass}>
                    <SlotCell slot={slot} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DaySlotItem({ slot }) {
  const teachers = slot.teachers?.length
    ? slot.teachers.map((tc) => tc.full_name ?? tc.short_code).join(', ')
    : t('routine.tba');
  const isCancelled = slot.status === 'cancelled';
  const liClass = `rounded-lg border p-3 ${isCancelled ? 'opacity-50' : ''}`;
  const titleClass = `font-medium ${isCancelled ? 'line-through' : ''}`;
  const timeRoom = slot.room_code
    ? `${fmtMin(slot.start_min)}–${fmtMin(slot.effective_end_min ?? slot.end_min)} · ${slot.room_code}`
    : `${fmtMin(slot.start_min)}–${fmtMin(slot.effective_end_min ?? slot.end_min)}`;
  return (
    <li key={slot.slot_id} className={liClass}>
      <div className="flex justify-between items-start">
        <div>
          <p className={titleClass}>
            {slot.course_code}
            {slot.course_name ? ` — ${slot.course_name}` : ''}
          </p>
          <p className="text-sm text-muted-foreground">{timeRoom}</p>
          <p className="text-xs text-muted-foreground">{teachers}</p>
          {slot.group && (
            <p className="text-xs text-muted-foreground">
              {t('routine.group').replace('{g}', slot.group)}
            </p>
          )}
          {slot.section && (
            <p className="text-xs text-muted-foreground">
              {t('routine.section').replace('{s}', slot.section)}
            </p>
          )}
        </div>
        {isCancelled && (
          <span className="text-xs rounded-full bg-destructive/10 text-destructive px-2 py-0.5">
            {t('routine.cancelled')}
          </span>
        )}
      </div>
    </li>
  );
}

function DayList({ days, today }) {
  const todayStr = today;
  const hasToday = days?.some((d) => d.date === todayStr);
  const defaultTab = hasToday ? todayStr : (days?.[0]?.date ?? todayStr);
  const [activeDate, setActiveDate] = useState(defaultTab);

  if (!days?.length) {
    return <p className="text-muted-foreground text-sm">{t('routine.noSlotsToday')}</p>;
  }

  let activeDay = days[0];
  for (const d of days) {
    if (d.date === activeDate) {
      activeDay = d;
      break;
    }
  }
  const drKind = activeDay.dayRule?.kind;
  const dayRuleLabel = drKind && drKind !== 'normal' ? (activeDay.dayRule.label ?? drKind) : null;

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-2">
        {days.map((day) => {
          const btnClass = `shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            activeDate === day.date
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground'
          }`;
          const label = day.date === todayStr ? t('routine.today') : day.date.slice(5);
          return (
            <button key={day.date} onClick={() => setActiveDate(day.date)} className={btnClass}>
              {label}
            </button>
          );
        })}
      </div>

      {dayRuleLabel && <p className="text-sm text-muted-foreground mb-2">{dayRuleLabel}</p>}

      {!activeDay.slots?.length ? (
        <p className="text-muted-foreground text-sm">{t('routine.noSlotsToday')}</p>
      ) : (
        <ul className="space-y-2">
          {activeDay.slots.map((slot) => (
            <DaySlotItem key={slot.slot_id} slot={slot} />
          ))}
        </ul>
      )}
    </div>
  );
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
        <h1 className="text-2xl font-semibold mb-4 flex items-center gap-2">
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
        <h1 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <CalendarDays className="size-6" aria-hidden="true" />
          {t('routine.title')}
        </h1>
        <p className="text-muted-foreground">{t('routine.noSemester')}</p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-4 flex items-center gap-2">
        <CalendarDays className="size-6" aria-hidden="true" />
        {t('routine.title')}
      </h1>

      <LiveStatusCard routineData={routineData} />

      {groupMissing && (
        <div className="rounded-lg border border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 mb-6 text-sm">
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
