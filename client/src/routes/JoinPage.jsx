import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useMe, useSignOut } from '@/features/auth/hooks.js';
import { useAppeal, useJoinOptions, useMyRequest, useSendRequest } from '@/features/join/hooks.js';
import { t } from '@/lib/i18n';

const selectClass = 'h-11 w-full rounded-md border bg-background px-3 text-sm';

/** JR-20: the last request was rejected: show the reason and the one-tap appeal. */
function RejectionNotice({ request }) {
  const appeal = useAppeal();
  const appealed = request.appeal ?? (appeal.isSuccess ? { status: 'open' } : null);
  return (
    <div className="space-y-2 rounded-md border border-destructive p-3" role="status">
      <p className="font-medium">{t('join.rejected.title')}</p>
      <p>
        <span className="text-sm font-medium">{t('join.rejected.reason')}</span> {request.reason}
      </p>
      {appealed ? (
        <p className="text-sm">{t(`join.appeal.${appealed.status}`)}</p>
      ) : (
        <Button
          variant="secondary"
          disabled={appeal.isPending}
          onClick={() => appeal.mutate(request.id)}
        >
          {t('join.appeal.send')}
        </Button>
      )}
      <FormError error={appeal.error} />
    </div>
  );
}

/** JR-01, JR-03, JR-05: the join form. */
export function JoinPage({ prefill = null, title, intro, footer } = {}) {
  const options = useJoinOptions();
  const mine = useMyRequest();
  const me = useMe();
  const send = useSendRequest();
  const signOut = useSignOut();
  // null means the student has not touched the choice yet, so the pre-fill (spec 14) applies.
  const [departmentChoice, setDepartmentChoice] = useState(null);
  const [sectionChoice, setSectionChoice] = useState(null);
  const [groupId, setGroupId] = useState('');
  const [fullName, setFullName] = useState(null);
  const [uvId, setUvId] = useState('');
  const fields = send.error?.fields ?? {};

  if (options.isPending || mine.isPending || options.isError) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('join.title')}</h1>
        {options.isError ? <FormError error={options.error} /> : <p>{t('common.loading')}</p>}
      </section>
    );
  }

  const departments = options.data.departments;
  const departmentId = departmentChoice ?? prefill?.department_id ?? '';
  const department = departments.find((d) => d.id === departmentId);
  const prefillLabel = prefill ? `${prefill.level}-${prefill.term}-${prefill.letter}` : null;
  const sectionId =
    sectionChoice ?? department?.sections.find((s) => s.label === prefillLabel)?.id ?? '';
  const section = department?.sections.find((s) => s.id === sectionId);
  const last = mine.data;
  // JR-01: the name and UV ID are asked until a claim has been approved.
  const needsUvId = last?.uv_id?.status !== 'approved';
  const firstRequest = !last;
  const name = fullName ?? me.data?.user?.full_name ?? '';

  function submit(event) {
    event.preventDefault();
    send.mutate({
      section_id: sectionId,
      ...(groupId && { group_id: groupId }),
      ...(needsUvId && uvId && { uv_id: uvId }),
      ...(firstRequest && name && { full_name: name }),
    });
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{title ?? t('join.title')}</h1>
      {last?.status === 'rejected' && <RejectionNotice request={last} />}
      <p>{intro ?? t('join.intro')}</p>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {firstRequest && (
          <div className="space-y-1.5">
            <label htmlFor="join-name" className="block text-sm font-medium">
              {t('join.fullName')}
            </label>
            <Input id="join-name" value={name} onChange={(e) => setFullName(e.target.value)} />
            {fields.full_name && (
              <p className="text-sm text-destructive">{t('join.fieldError.full_name')}</p>
            )}
          </div>
        )}
        {needsUvId && (
          <div className="space-y-1.5">
            <label htmlFor="join-uv" className="block text-sm font-medium">
              {t('join.uvId')}
            </label>
            <Input
              id="join-uv"
              inputMode="numeric"
              value={uvId}
              onChange={(e) => setUvId(e.target.value)}
              aria-describedby="join-uv-hint"
              aria-invalid={fields.uv_id ? 'true' : undefined}
            />
            <p id="join-uv-hint" className="text-sm text-muted-foreground">
              {t('join.uvIdHint')}
            </p>
            {fields.uv_id && (
              <p className="text-sm text-destructive">{t('join.fieldError.uv_id')}</p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="join-dept" className="block text-sm font-medium">
            {t('join.department')}
          </label>
          <select
            id="join-dept"
            className={selectClass}
            value={departmentId}
            onChange={(e) => {
              setDepartmentChoice(e.target.value);
              setSectionChoice('');
              setGroupId('');
            }}
          >
            <option value="">{t('join.choose')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} {d.name}
              </option>
            ))}
          </select>
        </div>
        {department?.setting_up && (
          <p role="status" className="rounded-md border p-3 text-sm">
            {t('join.settingUp')}
          </p>
        )}
        {department && !department.setting_up && (
          <div className="space-y-1.5">
            <label htmlFor="join-section" className="block text-sm font-medium">
              {t('join.section')}
            </label>
            <select
              id="join-section"
              className={selectClass}
              value={sectionId}
              onChange={(e) => {
                setSectionChoice(e.target.value);
                setGroupId('');
              }}
            >
              <option value="">{t('join.choose')}</option>
              {department.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {section?.groups.length > 0 && (
          <div className="space-y-1.5">
            <label htmlFor="join-group" className="block text-sm font-medium">
              {t('join.group')}
            </label>
            <select
              id="join-group"
              className={selectClass}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">{t('join.noGroup')}</option>
              {section.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <FormError error={send.error} />
        <Button type="submit" className="w-full" disabled={!sectionId || send.isPending}>
          {t('join.submit')}
        </Button>
      </form>
      {footer}
      <Button variant="secondary" className="w-full" onClick={() => signOut.mutate()}>
        {t('common.signOut')}
      </Button>
    </section>
  );
}
