import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import {
  DepartmentPicker,
  useAdminDepartment,
} from '@/features/teachers/components/useAdminDepartment.jsx';
import { useDecideRegistration, useRegistrations, useTeachers } from '@/features/teachers/hooks.js';
import { t } from '@/lib/i18n';

function RegistrationCard({ reg }) {
  const decide = useDecideRegistration();
  const records = useTeachers(reg.department_id);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const fields = decide.error?.fields ?? {};
  const free = (records.data ?? []).filter((r) => !r.linked);

  const approve = () =>
    decide.mutate({ id: reg.id, decision: 'approve', ...(teacherId && { teacher_id: teacherId }) });
  function reject(event) {
    event.preventDefault();
    decide.mutate({ id: reg.id, decision: 'reject', reason });
  }

  return (
    <li className="space-y-3 p-3">
      <div>
        <h3 className="font-medium">{reg.full_name}</h3>
        <dl className="grid gap-x-4 text-sm text-muted-foreground sm:grid-cols-2">
          <div>
            <dt className="inline">{t('teachers.registrations.email')}: </dt>
            <dd className="inline">{reg.email}</dd>
          </div>
          <div>
            <dt className="inline">{t('teachers.department')}: </dt>
            <dd className="inline">{reg.department?.code}</dd>
          </div>
          <div>
            <dt className="inline">{t('teachers.registrations.requestedCode')}: </dt>
            <dd className="inline">{reg.requested_short_code}</dd>
          </div>
          <div>
            <dt className="inline">{t('teachers.registrations.date')}: </dt>
            <dd className="inline">{new Date(reg.created_at).toLocaleDateString()}</dd>
          </div>
        </dl>
      </div>
      {reg.earlier_rejections.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">{t('teachers.registrations.earlier')}</p>
          <ul className="list-disc pl-5">
            {reg.earlier_rejections.map((e, i) => (
              <li key={i}>
                {t('teachers.registrations.earlierItem', {
                  code: e.requested_short_code,
                  reason: e.reason,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!rejecting ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={`link-${reg.id}`} className="block text-sm font-medium">
              {t('teachers.registrations.linkTo')}
            </label>
            <select
              id={`link-${reg.id}`}
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-72"
            >
              <option value="">{t('teachers.registrations.linkAuto')}</option>
              {free.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.short_code} {r.full_name}
                </option>
              ))}
            </select>
          </div>
          <FormError error={decide.error} />
          <div className="flex gap-2">
            <Button onClick={approve} disabled={decide.isPending}>
              {t('teachers.registrations.approve')}
            </Button>
            <Button variant="destructive" onClick={() => setRejecting(true)}>
              {t('teachers.registrations.reject')}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={reject} className="space-y-2" noValidate>
          <label htmlFor={`reason-${reg.id}`} className="block text-sm font-medium">
            {t('teachers.registrations.reasonLabel')}
          </label>
          <textarea
            id={`reason-${reg.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby={`reason-${reg.id}-hint`}
            aria-invalid={fields.reason ? 'true' : undefined}
            className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
          />
          <p id={`reason-${reg.id}-hint`} className="text-sm text-muted-foreground">
            {t('teachers.registrations.reasonHint')}
          </p>
          {fields.reason && (
            <p className="text-sm text-destructive">
              {t('teachers.registrations.fieldError.reason')}
            </p>
          )}
          <FormError error={decide.error} />
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={decide.isPending}>
              {t('teachers.registrations.confirmReject')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRejecting(false)}>
              {t('teachers.cancel')}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

/** TCH-02, TCH-03, TCH-04: the registration queue for department admins and super admins. */
export function TeacherRegistrationsPage() {
  const registrations = useRegistrations();
  const { choices, departmentId, setChosen } = useAdminDepartment();
  if (registrations.isPending) return <p>{t('common.loading')}</p>;
  if (registrations.error) return <FormError error={registrations.error} />;
  const filtered = choices.length > 1;
  const shown = registrations.data.filter((r) => !filtered || r.department_id === departmentId);

  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('teachers.registrations.title')}</h1>
      <DepartmentPicker
        id="registrations-department"
        choices={choices}
        value={departmentId}
        onChange={setChosen}
      />
      {shown.length === 0 ? (
        <p>{t('teachers.registrations.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shown.map((reg) => (
            <RegistrationCard key={reg.id} reg={reg} />
          ))}
        </ul>
      )}
    </section>
  );
}
