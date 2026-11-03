import { useState } from 'react';
import { t } from '@/lib/i18n';
import { activeDayOf, dayRuleLabelOf, fmtMin } from '@/features/routine/utils.js';

/** One class in a list: time, room, course, teachers, group and section. */
export function SlotItem({ slot }) {
  const teachers = slot.teachers?.length
    ? slot.teachers.map((tc) => tc.full_name ?? tc.short_code).join(', ')
    : t('routine.tba');
  const isCancelled = slot.status === 'cancelled';
  const liClass = `rounded-lg border p-3 ${isCancelled ? 'opacity-50' : ''}`;
  const titleClass = `font-medium ${isCancelled ? 'line-through' : ''}`;
  const end = fmtMin(slot.effective_end_min ?? slot.end_min);
  const timeRoom = slot.room_code
    ? `${fmtMin(slot.start_min)}–${end} · ${slot.room_code}`
    : `${fmtMin(slot.start_min)}–${end}`;
  return (
    <li className={liClass}>
      <div className="flex items-start justify-between">
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
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            {t('routine.cancelled')}
          </span>
        )}
      </div>
    </li>
  );
}

/** Phones: one day at a time, with a tab for each day in the range (RTN-18). */
export function DayList({ days, today }) {
  const hasToday = days?.some((d) => d.date === today);
  const defaultTab = hasToday ? today : (days?.[0]?.date ?? today);
  const [activeDate, setActiveDate] = useState(defaultTab);

  if (!days?.length) {
    return <p className="text-sm text-muted-foreground">{t('routine.noSlotsToday')}</p>;
  }

  const activeDay = activeDayOf(days, activeDate);
  const dayRuleLabel = dayRuleLabelOf(activeDay);

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-2">
        {days.map((day) => {
          const btnClass = `shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            activeDate === day.date
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground'
          }`;
          const label = day.date === today ? t('routine.today') : day.date.slice(5);
          return (
            <button key={day.date} onClick={() => setActiveDate(day.date)} className={btnClass}>
              {label}
            </button>
          );
        })}
      </div>

      {dayRuleLabel && <p className="mb-2 text-sm text-muted-foreground">{dayRuleLabel}</p>}

      {!activeDay.slots?.length ? (
        <p className="text-sm text-muted-foreground">{t('routine.noSlotsToday')}</p>
      ) : (
        <ul className="space-y-2">
          {activeDay.slots.map((slot) => (
            <SlotItem key={slot.slot_id} slot={slot} />
          ))}
        </ul>
      )}
    </div>
  );
}
