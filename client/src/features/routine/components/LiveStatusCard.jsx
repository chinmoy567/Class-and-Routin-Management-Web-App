import { t } from '@/lib/i18n';
import { fmtMin } from '@/features/routine/utils.js';
import { useLiveStatus } from '@/features/routine/hooks.js';

const ACCENT = {
  in_class: 'bg-green-100 dark:bg-green-900/30',
  teaching: 'bg-blue-100 dark:bg-blue-900/30',
};

/** The headline, sub-line and countdown for a live status (RTN-08 to RTN-13). */
export function statusText(status) {
  if (!status) return null;
  const { kind, slot, ends_at, next } = status;
  let headline = '';
  let sub = '';
  if (kind === 'in_class' || kind === 'teaching') {
    headline = t(kind === 'in_class' ? 'routine.statusInClass' : 'routine.statusTeaching');
    if (slot) {
      const endsTime = fmtMin(ends_at ?? slot.effective_end_min);
      sub = `${slot.course_code} · ${slot.room_code ?? ''} · ${t('routine.countdownEndsIn').replace('{time}', endsTime)}`;
    }
  } else if (kind === 'free') {
    headline = t('routine.statusFree');
    if (next?.slot) {
      sub = t('routine.countdownNextIn')
        .replace('{course}', next.slot.course_code ?? '')
        .replace('{time}', fmtMin(next.slot.start_min));
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
