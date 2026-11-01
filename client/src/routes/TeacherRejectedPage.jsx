import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useDepartments, useGoNext, useSignOut } from '@/features/auth/hooks.js';
import { useApplyAgain, useMyRegistration } from '@/features/teachers/hooks.js';
import { t } from '@/lib/i18n';

/** TCH-04, TCH-05: the rejected teacher sees the reason and can correct and apply again. */
export function TeacherRejectedPage() {
  const registration = useMyRegistration();
  const departments = useDepartments(true);
  const apply = useApplyAgain();
  const goNext = useGoNext();
  const signOut = useSignOut();
  const [departmentId, setDepartmentId] = useState('');
  const [shortCode, setShortCode] = useState(null);
  const current = registration.data;
  const chosenDepartment = departmentId || current?.department_id || '';
  const code = shortCode ?? current?.requested_short_code ?? '';
  const fields = apply.error?.fields ?? {};

  function submit(event) {
    event.preventDefault();
    apply.mutate(
      { department_id: chosenDepartment, short_code: code },
      { onSuccess: () => goNext('waiting-approval') },
    );
  }

  if (registration.isPending || departments.isPending) return <p>{t('common.loading')}</p>;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('teachers.rejected.title')}</h1>
      {current?.reason && (
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">{t('teachers.rejected.reasonLabel')}</p>
          <p>{current.reason}</p>
        </div>
      )}
      <p>{t('teachers.rejected.intro')}</p>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="apply-department" className="block text-sm font-medium">
            {t('teachers.department')}
          </label>
          <select
            id="apply-department"
            value={chosenDepartment}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-11 w-full rounded-md border bg-background px-3 text-sm"
          >
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} {d.name}
              </option>
            ))}
          </select>
          {fields.department_id && (
            <p className="text-sm text-destructive">
              {t('teachers.rejected.fieldError.department_id')}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="apply-code" className="block text-sm font-medium">
            {t('teachers.rejected.shortCode')}
          </label>
          <Input
            id="apply-code"
            value={code}
            onChange={(e) => setShortCode(e.target.value)}
            aria-describedby="apply-code-hint"
            aria-invalid={fields.short_code ? 'true' : undefined}
          />
          <p id="apply-code-hint" className="text-sm text-muted-foreground">
            {t('teachers.rejected.shortCodeHint')}
          </p>
          {fields.short_code && (
            <p className="text-sm text-destructive">
              {t('teachers.rejected.fieldError.short_code')}
            </p>
          )}
        </div>
        <FormError error={apply.error} />
        <Button type="submit" className="w-full" disabled={apply.isPending}>
          {t('teachers.rejected.apply')}
        </Button>
      </form>
      <Button variant="secondary" className="w-full" onClick={() => signOut.mutate()}>
        {t('common.signOut')}
      </Button>
    </section>
  );
}
