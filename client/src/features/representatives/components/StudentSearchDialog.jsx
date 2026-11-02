import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';
import { useStudentSearch } from '../hooks.js';

/** Translate the codes this screen can get; anything else falls back to the shared messages. */
export function assignErrorText(error, role) {
  if (error?.code === 'ROLE_LIMIT') {
    return t(role === 'cr' ? 'representatives.errors.crFull' : 'representatives.errors.dcrFull');
  }
  const key = `representatives.errors.${error?.code}`;
  return t(key) === key ? null : t(key);
}

/** CRD-01: pick a student, then confirm. Focus moves in on open and back out on close. */
export function StudentSearchDialog({ role, departmentId, onAssign, pending, error, onClose }) {
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState(null);
  const search = useStudentSearch(text, departmentId);
  const input = useRef(null);
  const opener = useRef(document.activeElement);

  useEffect(() => {
    input.current?.focus();
    const back = opener.current;
    return () => back?.focus?.();
  }, []);

  const roleName = t(`representatives.${role}`);
  const message = error ? assignErrorText(error, role) : null;
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="rep-dialog-title"
      className="space-y-3 rounded-md border p-4"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <h3 id="rep-dialog-title" className="font-medium">
        {t('representatives.assignTo', { role: roleName })}
      </h3>
      <div className="space-y-1.5">
        <label htmlFor="rep-search" className="block text-sm font-medium">
          {t('representatives.search')}
        </label>
        <input
          id="rep-search"
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setChosen(null);
          }}
          className="h-11 w-full rounded-md border bg-background px-3 text-sm"
          aria-describedby="rep-search-hint"
        />
        <p id="rep-search-hint" className="text-xs text-muted-foreground">
          {t('representatives.searchHint')}
        </p>
      </div>
      {search.isFetching && <p className="text-sm">{t('representatives.searching')}</p>}
      {search.isSuccess && search.data.length === 0 && (
        <p className="text-sm">{t('representatives.noResults')}</p>
      )}
      <ul className="space-y-1" aria-label={t('representatives.results')}>
        {(search.data ?? []).map((s) => (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={chosen?.id === s.id}
              onClick={() => setChosen(s)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm aria-pressed:border-primary aria-pressed:font-semibold"
            >
              <span>{s.full_name}</span>
              <span className="text-xs text-muted-foreground">
                {s.uv_id ? `${t('representatives.uvId', { id: s.uv_id })} · ` : ''}
                {t(`representatives.state.${s.state}`)}
                {chosen?.id === s.id ? ' ✓' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error &&
        (message ? (
          <p
            role="alert"
            className="rounded-md border border-destructive p-3 text-sm text-destructive"
          >
            {message}
          </p>
        ) : (
          <FormError error={error} />
        ))}
      <div className="flex gap-2">
        <Button type="button" disabled={!chosen || pending} onClick={() => onAssign(chosen)}>
          {pending ? t('representatives.assigning') : t('representatives.confirm')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('representatives.cancel')}
        </Button>
      </div>
    </div>
  );
}
