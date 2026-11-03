import { t } from '@/lib/i18n';
import { fmtMin } from '@/features/routine/utils.js';
import { useLiveStatus } from '@/features/routine/hooks.js';

const ACCENT = {
  in_class: 'bg-green-100 dark:bg-green-900/30',
  teaching: 'bg-blue-100 dark:bg-blue-900/30',
};

/** RTN-10: "1 h 10 min" or "25 min" for a number of minutes. */
export function durationText(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h
    ? t('routine.durationHm')
        .replace('{h}', h)
        .replace('{m}', m % 60)
    : t('routine.durationM').replace('{m}', m);
}

/** The teacher names of a slot (both names for a shared lab), joined. */
const teacherNames = (slot) =>
  (slot.teachers ?? []).map((tc) => tc.full_name ?? tc.short_code).join(', ');

/** The headline, sub-line and countdown for a live status (RTN-08 to RTN-13). */
export function statusText(status) {
  if (!status) return null;
  const { kind, slot, ends_at: endsAt, next, now_min: nowMin, today } = status;
  let headline = '';
  let sub = '';
  if (kind === 'in_class' || kind === 'teaching') {
    headline = t(kind === 'in_class' ? 'routine.statusInClass' : 'routine.statusTeaching');
    if (slot) {
      const end = endsAt ?? slot.effective_end_min;
      const countdown = t('routine.countdownEndsIn').replace('{time}', durationText(end - nowMin));
      sub = [slot.course_code, teacherNames(slot), slot.room_code, countdown]
        .filter(Boolean)
        .join(' · ');
    }
  } else if (kind === 'free') {
    headline = t('routine.statusFree');
    if (next?.slot) {
      const s = next.slot;
      const when =
        next.date === today
          ? t('routine.countdownNextIn').replace('{time}', durationText(s.start_min - nowMin))
          : t('routine.countdownNextOn')
              .replace('{day}', next.date)
              .replace('{time}', fmtMin(s.start_min));
      sub = [when.replace('{course}', s.course_code ?? ''), teacherNames(s), s.room_code]
        .filter(Boolean)
        .join(' · ');
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
  return { kind, headline, sub, accent: ACCENT[kind] ?? 'bg-secondary' };
}

/** RTN-08 to RTN-13: the status card. Ticks on its own, so it never needs a reload. */
export function LiveStatusCard({ routineData }) {
  const status = useLiveStatus(routineData);
  const text = statusText(status);
  if (!text) return null;
  return (
    <div className={`mb-6 rounded-lg p-4 ${text.accent}`}>
      <p className="text-base font-semibold">{text.headline}</p>
      {text.sub && <p className="mt-1 text-sm text-muted-foreground">{text.sub}</p>}
    </div>
  );
}
