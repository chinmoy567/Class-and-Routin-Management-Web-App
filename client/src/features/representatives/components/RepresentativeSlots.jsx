import { Button } from '@/components/ui/button.jsx';
import { t } from '@/lib/i18n';

function Person({ rep }) {
  return (
    <span className="flex items-center gap-2">
      {rep.photo_url ? (
        <img src={rep.photo_url} alt="" className="size-8 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-muted text-xs"
        >
          {rep.full_name.slice(0, 1)}
        </span>
      )}
      <span>
        {rep.full_name}
        {rep.state && (
          <span className="block text-xs text-muted-foreground">
            {t(`representatives.state.${rep.state}`)}
          </span>
        )}
      </span>
    </span>
  );
}

function Slot({ role, rep, editable, onAssign, onRemove }) {
  const roleName = t(`representatives.${role}`);
  return (
    <li
      data-role={role}
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
    >
      <span className="w-12 text-sm font-medium">{roleName}</span>
      <span className="min-w-0 flex-1">
        {rep ? (
          <Person rep={rep} />
        ) : (
          <span className="text-muted-foreground">{t('representatives.empty')}</span>
        )}
      </span>
      {editable &&
        (rep ? (
          <Button
            type="button"
            variant="secondary"
            aria-label={t('representatives.removeFor', { name: rep.full_name })}
            onClick={() => onRemove(rep)}
          >
            {t('representatives.remove')}
          </Button>
        ) : (
          <Button type="button" onClick={() => onAssign(role)}>
            {t('representatives.assignTo', { role: roleName })}
          </Button>
        ))}
    </li>
  );
}

function isCr(r) {
  return r.role === 'cr';
}
function isDcr(r) {
  return r.role === 'dcr';
}

/** One CR slot and two DCR slots (CRD-02). */
export function RepresentativeSlots({ reps, editable, onAssign, onRemove }) {
  const cr = reps.find(isCr);
  const dcrs = reps.filter(isDcr);
  return (
    <ul className="space-y-2">
      <Slot role="cr" rep={cr} editable={editable} onAssign={onAssign} onRemove={onRemove} />
      <Slot role="dcr" rep={dcrs[0]} editable={editable} onAssign={onAssign} onRemove={onRemove} />
      <Slot role="dcr" rep={dcrs[1]} editable={editable} onAssign={onAssign} onRemove={onRemove} />
    </ul>
  );
}
