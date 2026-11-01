import { useState } from 'react';
import { FormError } from '@/features/auth/components/FormError.jsx';
import {
  useAdminSemesters,
  useBootstrapSemester,
  useCreateSemester,
  useDeleteSemester,
  useUpdateSemester,
} from '@/features/admin/hooks.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { t } from '@/lib/i18n';

function Field({ id, label, value, onChange, error, hint, type }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? 'true' : undefined}
      />
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Create form, or the edit form of one semester (`editing` is the semester). */
function SemesterForm({ editing, onDone }) {
  const create = useCreateSemester();
  const update = useUpdateSemester();
  const mutation = editing ? update : create;
  const [name, setName] = useState(editing?.name ?? '');
  const [start, setStart] = useState(editing?.start_date ?? '');
  const [end, setEnd] = useState(editing?.end_date ?? '');
  const fields = mutation.error?.fields ?? {};
  const err = (key) => (fields[key] ? t(`admin.semesters.fieldError.${key}`) : null);

  function submit(event) {
    event.preventDefault();
    const body = { name, start_date: start, end_date: end };
    mutation.mutate(editing ? { id: editing.id, ...body } : body, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border p-4" noValidate>
      <Field
        id="sem-name"
        label={t('admin.semesters.name')}
        value={name}
        onChange={setName}
        error={err('name')}
        hint={t('admin.semesters.nameHint')}
      />
      <Field
        id="sem-start"
        type="date"
        label={t('admin.semesters.start')}
        value={start}
        onChange={setStart}
        error={err('start_date')}
      />
      <Field
        id="sem-end"
        type="date"
        label={t('admin.semesters.end')}
        value={end}
        onChange={setEnd}
        error={err('end_date')}
      />
      <FormError error={mutation.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {editing ? t('admin.semesters.save') : t('admin.semesters.create')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('admin.semesters.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** SEM-01 to SEM-04, SEM-07: the semesters list. Super admin only (the server enforces it). */
export function SemestersPage() {
  const { data, isPending, error } = useAdminSemesters();
  const remove = useDeleteSemester();
  const bootstrap = useBootstrapSemester();
  const [mode, setMode] = useState(null); // null | 'new' | semester id

  if (isPending && !error) return <p>{t('common.loading')}</p>;
  if (error) return <FormError error={error} />;

  const hasDraft = data.some((s) => s.status === 'draft');
  // SEM-07: only while nothing has ever been current.
  const firstEver = !data.some((s) => s.status !== 'draft' || s.made_current_at);

  function onDelete(s) {
    if (window.confirm(t('admin.semesters.deleteConfirm', { name: s.name }))) remove.mutate(s.id);
  }
  function onBootstrap(s) {
    if (window.confirm(t('admin.semesters.bootstrapConfirm', { name: s.name }))) {
      bootstrap.mutate(s.id);
    }
  }

  return (
    <section className="max-w-2xl space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('admin.semesters.title')}</h1>
        {mode !== 'new' && !hasDraft && (
          <Button onClick={() => setMode('new')}>{t('admin.semesters.add')}</Button>
        )}
      </header>

      {mode === 'new' && <SemesterForm onDone={() => setMode(null)} />}
      <FormError error={remove.error ?? bootstrap.error} />

      {data.length === 0 ? (
        <p>{t('admin.semesters.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.map((s) => {
            if (mode === s.id) {
              return (
                <li key={s.id} className="p-3">
                  <SemesterForm editing={s} onDone={() => setMode(null)} />
                </li>
              );
            }
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('admin.semesters.dates', { start: s.start_date, end: s.end_date })}
                    {' · '}
                    {t(`admin.semesters.status.${s.status}`)}
                  </p>
                  {s.status === 'draft' && firstEver && (
                    <p className="text-sm text-muted-foreground">
                      {t('admin.semesters.bootstrapHint')}
                    </p>
                  )}
                </div>
                {s.status !== 'archived' && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setMode(s.id)}>
                      {t('admin.semesters.edit')}
                    </Button>
                    {s.status === 'draft' && firstEver && (
                      <Button onClick={() => onBootstrap(s)}>
                        {t('admin.semesters.bootstrap')}
                      </Button>
                    )}
                    {s.status === 'draft' && (
                      <Button variant="destructive" onClick={() => onDelete(s)}>
                        {t('admin.semesters.delete')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
