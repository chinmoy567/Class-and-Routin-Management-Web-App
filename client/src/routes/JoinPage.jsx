import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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

/** JR-01: the name is asked on the first request only. Spec 24: there is no UV ID on this form. */
const joinSchema = z.object({
  full_name: z.string().optional(),
  department_id: z.string(),
  section_id: z.string().min(1),
  group_id: z.string().optional(),
});

/**
 * The effective choices: what the student picked, or else the spec 14 pre-fill. `undefined`
 * means "not touched yet", so an empty string (the "choose" option) is kept as a real choice.
 */
function choicesFrom(values, { prefill, departments, accountName }) {
  const departmentId = values.department_id ?? prefill?.department_id ?? '';
  const department = departments.find((d) => d.id === departmentId);
  const prefillLabel = prefill ? `${prefill.level}-${prefill.term}-${prefill.letter}` : null;
  const sectionId =
    values.section_id ?? department?.sections.find((s) => s.label === prefillLabel)?.id ?? '';
  const section = department?.sections.find((s) => s.id === sectionId);
  return {
    departmentId,
    department,
    sectionId,
    section,
    fullName: values.full_name ?? accountName ?? '',
    groupId: values.group_id ?? '',
  };
}

/** JR-01, JR-03: the join form. */
export function JoinPage({ prefill = null, title, intro, footer } = {}) {
  const options = useJoinOptions();
  const mine = useMyRequest();
  const me = useMe();
  const send = useSendRequest();
  const signOut = useSignOut();

  const departments = options.data?.departments ?? [];
  const last = mine.data;
  const firstRequest = !last;
  const accountName = me.data?.user?.full_name;
  const context = { prefill, departments, accountName };

  const form = useForm({
    resolver: (values, ctx, opts) => {
      const c = choicesFrom(values, context);
      return zodResolver(joinSchema)(
        { ...values, department_id: c.departmentId, section_id: c.sectionId },
        ctx,
        opts,
      );
    },
    defaultValues: {
      full_name: undefined,
      department_id: undefined,
      section_id: undefined,
      group_id: undefined,
    },
  });
  const { control, handleSubmit, setValue, watch } = form;
  const c = choicesFrom(watch(), context);
  const fields = send.error?.fields ?? {};

  if (options.isPending || mine.isPending || options.isError) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('join.title')}</h1>
        {options.isError ? <FormError error={options.error} /> : <p>{t('common.loading')}</p>}
      </section>
    );
  }

  const onValid = () => {
    send.mutate({
      section_id: c.sectionId,
      ...(c.groupId && { group_id: c.groupId }),
      ...(firstRequest && c.fullName && { full_name: c.fullName }),
    });
  };

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{title ?? t('join.title')}</h1>
      {last?.status === 'rejected' && <RejectionNotice request={last} />}
      <p>{intro ?? t('join.intro')}</p>
      <form onSubmit={handleSubmit(onValid)} className="space-y-3" noValidate>
        {firstRequest && (
          <div className="space-y-1.5">
            <label htmlFor="join-name" className="block text-sm font-medium">
              {t('join.fullName')}
            </label>
            <Controller
              name="full_name"
              control={control}
              render={({ field }) => (
                <Input
                  id="join-name"
                  value={c.fullName}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                />
              )}
            />
            {fields.full_name && (
              <p className="text-sm text-destructive">{t('join.fieldError.full_name')}</p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="join-dept" className="block text-sm font-medium">
            {t('join.department')}
          </label>
          <Controller
            name="department_id"
            control={control}
            render={({ field }) => (
              <select
                id="join-dept"
                className={selectClass}
                value={c.departmentId}
                onBlur={field.onBlur}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  setValue('section_id', '');
                  setValue('group_id', '');
                }}
              >
                <option value="">{t('join.choose')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} {d.name}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
        {c.department?.setting_up && (
          <p role="status" className="rounded-md border p-3 text-sm">
            {t('join.settingUp')}
          </p>
        )}
        {c.department && !c.department.setting_up && (
          <div className="space-y-1.5">
            <label htmlFor="join-section" className="block text-sm font-medium">
              {t('join.section')}
            </label>
            <Controller
              name="section_id"
              control={control}
              render={({ field }) => (
                <select
                  id="join-section"
                  className={selectClass}
                  value={c.sectionId}
                  onBlur={field.onBlur}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    setValue('group_id', '');
                  }}
                >
                  <option value="">{t('join.choose')}</option>
                  {c.department.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
            />
          </div>
        )}
        {c.section?.groups.length > 0 && (
          <div className="space-y-1.5">
            <label htmlFor="join-group" className="block text-sm font-medium">
              {t('join.group')}
            </label>
            <Controller
              name="group_id"
              control={control}
              render={({ field }) => (
                <select
                  id="join-group"
                  className={selectClass}
                  value={c.groupId}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(e.target.value)}
                >
                  <option value="">{t('join.noGroup')}</option>
                  {c.section.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              )}
            />
          </div>
        )}
        <FormError error={send.error} />
        <Button type="submit" className="w-full" disabled={!c.sectionId || send.isPending}>
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
