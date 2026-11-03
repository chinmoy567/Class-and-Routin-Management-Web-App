import { PERIODS } from '@crm/shared';
import { t } from '@/lib/i18n';
import { slotForPeriod } from '@/features/routine/utils.js';

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

export function SlotCell({ slot }) {
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

/** RTN-17: Sunday to Thursday against the period columns; today is highlighted. */
export function WeekGrid({ week, today }) {
  if (!week?.length) {
    return <p className="text-sm text-muted-foreground">{t('routine.noSlotsToday')}</p>;
  }

  const todayDow = dowOf(today);

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
          {PERIODS.map((period) => (
            <tr key={period.start_min}>
              <td className="whitespace-nowrap border bg-muted px-2 py-1 text-muted-foreground">
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
