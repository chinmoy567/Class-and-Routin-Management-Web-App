import { useState } from 'react';
import { FormError } from '@/features/auth/components/FormError.jsx';
import {
  useAdminDepartments,
  useCreateDepartment,
  useRetireDepartment,
  useUpdateDepartment,
} from '@/features/admin/hooks.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { t } from '@/lib/i18n';

/** Create form, or the edit form of one department (`editing` is the department). */
function DepartmentForm({ editing, onDone }) {
  const create = useCreateDepartment();
  const update = useUpdateDepartment();
  const mutation = editing ? update : create;
  const [code, setCode] = useState(editing?.code ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const fields = mutation.error?.fields ?? {};

  function submit(event) {
    event.preventDefault();
    const body = editing ? { id: editing.id, code, name } : { code, name };
    mutation.mutate(body, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border p-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="dept-code" className="block text-sm font-medium">
          {t('admin.departments.code')}
        </label>
        <Input
          id="dept-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          aria-invalid={fields.code ? 'true' : undefined}
          aria-describedby="dept-code-hint"
        />
        <p id="dept-code-hint" className="text-sm text-muted-foreground">
          {t('admin.departments.codeHint')}
        </p>
        {fields.code && (
          <p className="text-sm text-destructive">{t('admin.departments.fieldError.code')}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="dept-name" className="block text-sm font-medium">
          {t('admin.departments.name')}
        </label>
        <Input
          id="dept-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={fields.name ? 'true' : undefined}
        />
        {fields.name && (
          <p className="text-sm text-destructive">{t('admin.departments.fieldError.name')}</p>
        )}
      </div>
      <FormError error={mutation.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {editing ? t('admin.departments.save') : t('admin.departments.create')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('admin.departments.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** DEP-01 to DEP-03: the department list. Super admin only (the server enforces it). */
export function DepartmentsPage() {
  const { data, isPending, error } = useAdminDepartments();
  const retire = useRetireDepartment();
  const [mode, setMode] = useState(null); // null | 'new' | department id

  if (isPending && !error) return <p>{t('common.loading')}</p>;
  if (error) return <FormError error={error} />;

  function onRetire(d) {
    if (window.confirm(t('admin.departments.retireConfirm', { code: d.code }))) {
      retire.mutate(d.id);
    }
  }

  return (
    <section className="max-w-2xl space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('admin.departments.title')}</h1>
        {mode !== 'new' && (
          <Button onClick={() => setMode('new')}>{t('admin.departments.add')}</Button>
        )}
      </header>

      {mode === 'new' && <DepartmentForm onDone={() => setMode(null)} />}
      <FormError error={retire.error} />

      {data.length === 0 ? (
        <p>{t('admin.departments.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.map((d) => {
            if (mode === d.id) {
              return (
                <li key={d.id} className="p-3">
                  <DepartmentForm editing={d} onDone={() => setMode(null)} />
                </li>
              );
            }
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-medium">
                    {d.code} <span className="font-normal">{d.name}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {d.retired ? t('admin.departments.retired') : t('admin.departments.active')}
                  </p>
                </div>
                {!d.retired && (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setMode(d.id)}>
                      {t('admin.departments.rename')}
                    </Button>
                    <Button variant="destructive" onClick={() => onRetire(d)}>
                      {t('admin.departments.retire')}
                    </Button>
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
