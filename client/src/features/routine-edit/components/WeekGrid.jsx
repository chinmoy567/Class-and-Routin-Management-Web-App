import { Button } from '@/components/ui/button.jsx';
import { t } from '@/lib/i18n';

const DAYS = [0, 1, 2, 3, 4];

function onDay(slots, day) {
  return slots.filter((s) => s.day_of_week === day);
}

function SlotCard({ slot, onEdit, onDelete }) {
  const teachers = slot.teachers === 'TBA' ? 'TBA' : slot.teachers.join(', ');
  return (
    <li
      data-editable={slot.editable}
      className={`space-y-1 rounded-md border p-3 text-sm ${
        slot.editable ? 'bg-background' : 'bg-muted text-muted-foreground'
      }`}
    >
      <p className="font-medium">
        {slot.start}–{slot.end} · {slot.course_code}
      </p>
      {slot.course_name && <p>{slot.course_name}</p>}
      <p>
        {slot.group ? t('routineEdit.group', { label: slot.group }) : t('routineEdit.wholeSection')}
        {' · '}
        {slot.room}
      </p>
      <p>{teachers}</p>
      {slot.combined && <p>{t('routineEdit.combined')}</p>}
      {slot.edited_by_hand && <p>{t('routineEdit.editedByHand')}</p>}
      {slot.editable ? (
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => onEdit(slot)}>
            {t('routineEdit.edit')}
            <span className="sr-only"> {slot.course_code}</span>
          </Button>
          <Button type="button" variant="secondary" onClick={() => onDelete(slot)}>
            {t('routineEdit.delete')}
            <span className="sr-only"> {slot.course_code}</span>
          </Button>
        </div>
      ) : (
        <p className="font-medium">
          {t('routineEdit.ownedBy', { code: slot.owner_department.code })} ·{' '}
          {t('routineEdit.readOnly')}
        </p>
      )}
    </li>
  );
}

/** EDT-01: Sunday to Thursday. A day list on phones, five columns from `lg` up. */
export function WeekGrid({ slots, onEdit, onDelete }) {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {DAYS.map((day) => {
        const list = onDay(slots, day);
        return (
          <section key={day} aria-labelledby={`day-${day}`} className="space-y-2">
            <h3 id={`day-${day}`} className="font-semibold">
              {t(`routineEdit.days.${day}`)}
            </h3>
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('routineEdit.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {list.map((s) => (
                  <SlotCard key={s.id} slot={s} onEdit={onEdit} onDelete={onDelete} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
