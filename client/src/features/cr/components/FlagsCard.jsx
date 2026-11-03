import { useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FLAG_CATEGORIES } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { FormError, applyFieldErrors } from '@/features/auth/components/FormError.jsx';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import { formatDhaka } from '@/lib/time';
import { t } from '@/lib/i18n';
import { useRaiseFlag } from '../hooks.js';

const selectClass = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm';
const areaClass = 'min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm';

/** The flag form: category, an optional student from the roster, and the description (10-1,000). */
function FlagForm({ sectionId, roster }) {
  const id = useId();
  const raise = useRaiseFlag(sectionId);
  const schema = useMemo(
    () =>
      z.object({
        category: z.enum(FLAG_CATEGORIES, { error: t('cr.flag.errors.category') }),
        student_id: z.string(),
        description: z
          .string({ error: t('cr.flag.errors.short') })
          .trim()
          .min(10, t('cr.flag.errors.short'))
          .max(1000, t('cr.flag.errors.long')),
      }),
    [],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { category: 'other', student_id: '', description: '' },
  });

  return (
    <form
      noValidate
      className="mt-3 space-y-3 rounded-md border p-3"
      aria-labelledby={`${id}-title`}
      onSubmit={handleSubmit((values) => {
        const body = {
          category: values.category,
          description: values.description,
          ...(values.student_id && { student_id: values.student_id }),
        };
        raise.mutate(body, {
          onSuccess: () => reset(),
          onError: (err) => applyFieldErrors(err, setError),
        });
      })}
    >
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {t('cr.flag.title')}
      </h3>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-category`} className="block text-sm font-medium">
          {t('cr.flag.category')}
        </label>
        <select id={`${id}-category`} className={selectClass} {...register('category')}>
          {FLAG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`cr.flag.categories.${c}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-student`} className="block text-sm font-medium">
          {t('cr.flag.student')}
        </label>
        <select id={`${id}-student`} className={selectClass} {...register('student_id')}>
          <option value="">{t('cr.flag.noStudent')}</option>
          {roster.map((s) => (
            <option key={s.user_id} value={s.user_id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-description`} className="block text-sm font-medium">
          {t('cr.flag.description')}
        </label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {t('cr.flag.descriptionHint')}
        </p>
        <textarea
          id={`${id}-description`}
          className={areaClass}
          aria-describedby={`${id}-hint${errors.description ? ` ${id}-error` : ''}`}
          aria-invalid={errors.description ? 'true' : undefined}
          {...register('description')}
        />
        {errors.description && (
          <p id={`${id}-error`} className="text-sm text-destructive">
            {errors.description.message}
          </p>
        )}
      </div>
      <FormError error={raise.error} />
      {raise.isSuccess && (
        <p role="status" className="text-sm">
          {t('cr.flag.sent')}
        </p>
      )}
      <Button type="submit" disabled={raise.isPending}>
        {t('cr.flag.submit')}
      </Button>
    </form>
  );
}

/** CRD-DSH-08, CRD-DSH-11: the flags this section raised this semester, and the flag form. */
export function FlagsCard({ sectionId, flags, roster }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <DashboardCard id={id} title={t('cr.flags.heading')}>
      <Button
        type="button"
        variant="secondary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {t('cr.flags.raise')}
      </Button>
      {open && <FlagForm sectionId={sectionId} roster={roster} />}

      {flags.length === 0 ? (
        <CardMessage>{t('cr.flags.empty')}</CardMessage>
      ) : (
        <ul className="mt-3 space-y-2">
          {flags.map((f) => (
            <li key={f.id} className="space-y-1 rounded-md border p-3 text-sm">
              <p className="font-medium">
                {t(`cr.flag.categories.${f.category}`)}
                {f.student ? ` · ${f.student.name}` : ''}
              </p>
              <p>{f.description}</p>
              <p className="text-xs text-muted-foreground">
                {t(`cr.flag.status.${f.status}`)}
                {' · '}
                {formatDhaka(new Date(f.created_at), 'd MMM yyyy')}
                {f.raised_by_me ? ` · ${t('cr.flag.raisedByMe')}` : ''}
              </p>
              {f.reply && (
                <p className="text-xs">{t('cr.flag.reply').replace('{reply}', f.reply)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
