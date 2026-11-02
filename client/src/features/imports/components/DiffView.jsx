import { t } from '@/lib/i18n';
import { hhmm } from './time.js';

const when = (x) => `${t(`imports.day.${x.day}`)} ${hhmm(x.start_min)}–${hhmm(x.end_min)}`;

function Choice({ slot, onChoose, disabled }) {
  if (!slot.edited_by_hand) return null;
  return (
    <fieldset className="mt-1 space-y-1" disabled={disabled}>
      <legend className="text-sm">
        ({t('imports.editedByHand')}) {t('imports.keepFor', { course: slot.course_code })}
      </legend>
      {['keep', 'replace'].map((value) => (
        <label key={value} className="mr-4 inline-flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name={`choice-${slot.id}`}
            checked={slot.choice === value}
            onChange={() => onChoose(slot.id, value)}
          />
          {t(`imports.${value}`)}
        </label>
      ))}
    </fieldset>
  );
}

export function DiffView({ diff, onChoose, saving }) {
  const empty = !diff.added.length && !diff.removed.length && !diff.changed.length;
  return (
    <section aria-labelledby="diff-h" className="space-y-3">
      <h2 id="diff-h" className="text-lg font-semibold">
        {t('imports.diff')}
      </h2>
      {empty && <p className="text-sm text-muted-foreground">{t('imports.noDiff')}</p>}
      {diff.added.length > 0 && (
        <div>
          <h3 className="font-medium">{t('imports.added')}</h3>
          <ul className="text-sm">
            {diff.added.map((r) => (
              <li key={r.row}>
                {r.section_key} · {when(r)} · {r.course_code}
              </li>
            ))}
          </ul>
        </div>
      )}
      {diff.removed.length > 0 && (
        <div>
          <h3 className="font-medium">{t('imports.removed')}</h3>
          <ul className="text-sm">
            {diff.removed.map((s) => (
              <li key={s.id}>
                {s.section_key} · {when(s)} · {s.course_code}
                <Choice slot={s} onChoose={onChoose} disabled={saving} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {diff.changed.length > 0 && (
        <div>
          <h3 className="font-medium">{t('imports.changed')}</h3>
          <ul className="text-sm">
            {diff.changed.map(({ slot, row }) => (
              <li key={slot.id}>
                {slot.section_key} · {when(slot)} → {when(row)} · {row.course_code}
                <Choice slot={slot} onChoose={onChoose} disabled={saving} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
