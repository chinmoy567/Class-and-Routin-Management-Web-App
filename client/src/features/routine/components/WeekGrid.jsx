import { useState } from 'react';
import { PERIODS } from '@crm/shared';
import { t } from '@/lib/i18n';
import { placeSlots } from '@/features/routine/utils.js';

const DAY_LABEL_KEYS = [
  'routine.daySun',
  'routine.dayMon',
  'routine.dayTue',
  'routine.dayWed',
  'routine.dayThu',
];

/** Day of week (0 = Sunday) for an institution date string from the server. */
export const dowOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

function pickShortCode(tc) {
  return tc.short_code ?? tc.full_name;
}

function fullNameOf(tc) {
  return tc.full_name ?? tc.short_code;
}

/** RTN-17: a cell shows the short codes; tapping them shows the full names. */
export function SlotCell({ slot, running = false }) {
  const [showNames, setShowNames] = useState(false);
  if (!slot) return null;
  const hasTeachers = Boolean(slot.teachers?.length);
  const codes = hasTeachers ? slot.teachers.map(pickShortCode).join(', ') : t('routine.tba');
  const names = hasTeachers ? slot.teachers.map(fullNameOf).join(', ') : t('routine.tba');
  const cancelled = slot.status === 'cancelled';
  const cellClass = cancelled
    ? 'rounded px-1 py-1 text-xs leading-tight opacity-40 line-through'
    : 'rounded px-1 py-1 text-xs leading-tight bg-primary/10';
  return (
    <div className={cellClass}>
      {running && <div className="font-semibold text-primary">{t('routine.runningNow')}</div>}
      <div className="font-medium">{slot.course_code}</div>
      {(slot.section_label || slot.group) && (
        <div className="text-muted-foreground">
          {[slot.section_label, slot.group].filter(Boolean).join(' · ')}
        </div>
      )}
      {slot.room_code && <div className="text-muted-foreground">{slot.room_code}</div>}
      <button
        type="button"
        aria-expanded={showNames}
        onClick={() => setShowNames(!showNames)}
        className="text-left text-muted-foreground underline-offset-2 hover:underline"
      >
        {codes}
      </button>
      {showNames && <div className="text-muted-foreground">{names}</div>}
    </div>
  );
}

/** RTN-17: Sunday to Thursday against the period columns; today is highlighted. */
export function WeekGrid({ week, today, runningSlotId = null }) {
  if (!week?.length) {
    return <p className="text-sm text-muted-foreground">{t('routine.noSlotsToday')}</p>;
  }

  const todayDow = dowOf(today);
  const placements = DAY_LABEL_KEYS.map((_, dow) => {
    const daySlots = week.find((d) => d.day_of_week === dow)?.slots ?? [];
    return placeSlots(daySlots, PERIODS);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] border-collapse text-xs">
        <thead>
          <tr>
            <th className="w-24 border bg-muted px-2 py-1 text-left">{t('routine.week')}</th>
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
          {PERIODS.map((period, row) => (
            <tr key={period.start_min}>
              <td className="whitespace-nowrap border bg-muted px-2 py-1 text-muted-foreground">
                {period.label}
              </td>
              {placements.map((placed, dow) => {
                if (placed.covered.has(row)) return null; // part of a block that started above
                const hit = placed.starts.get(row);
                const tdClass = `border px-1 py-1 align-top ${todayDow === dow ? 'bg-primary/5' : ''}`;
                const running = Boolean(hit) && hit.slot.slot_id === runningSlotId;
                return (
                  <td
                    key={dow}
                    className={tdClass}
                    rowSpan={hit?.span ?? 1}
                    aria-current={running ? 'true' : undefined}
                  >
                    <SlotCell slot={hit?.slot ?? null} running={running} />
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
