// Spec 18, ADM-03 and ADM-18: the flags raised by CR and DCR. The admin marks each open flag fixed or rejected
// with a reply (1 to 1,000 characters). The server answers ALREADY_DECIDED if someone else decided it first.
import { useId, useState } from 'react';
import { useIsSuperAdmin } from '@/features/auth/hooks.js';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { Button } from '@/components/ui/button.jsx';
import { DepartmentFilter } from '@/features/admin/components/DashboardCards.jsx';
import { useAdminFlags, useResolveFlag } from '@/features/admin/hooks.js';
import { formatDhaka } from '@/lib/time';
import { t } from '@/lib/i18n';
import { resolveFlagBody } from '@crm/shared';

const TABS = ['open', 'fixed', 'rejected'];

function ResolveForm({ flag }) {
  const id = useId();
  const resolve = useResolveFlag();
  const [reply, setReply] = useState('');
  const [error, setError] = useState(null);
  const submit = (status) => {
    const parsed = resolveFlagBody.safeParse({ status, reply });
    if (!parsed.success) {
      setError(t('admin.flags.replyError'));
      return;
    }
    setError(null);
    resolve.mutate({ id: flag.id, ...parsed.data });
  };
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {t('admin.flags.replyLabel')}
      </label>
      <textarea
        id={id}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={2}
        maxLength={1000}
        aria-invalid={error ? 'true' : undefined}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={resolve.isPending} onClick={() => submit('fixed')}>
          {t('admin.flags.markFixed')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={resolve.isPending}
          onClick={() => submit('rejected')}
        >
          {t('admin.flags.markRejected')}
        </Button>
      </div>
      <FormError error={resolve.error} />
    </div>
  );
}

export function AdminFlagsPage() {
  const isSuper = useIsSuperAdmin();
  const [status, setStatus] = useState('open');
  const [departmentId, setDepartmentId] = useState(null);
  const { data = [], isPending, error } = useAdminFlags({ status, department_id: departmentId });

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-semibold">{t('admin.flags.title')}</h1>
        {isSuper && <DepartmentFilter value={departmentId} onChange={setDepartmentId} />}
      </div>

      <div role="group" aria-label={t('admin.flags.title')} className="flex gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab}
            type="button"
            variant={status === tab ? 'default' : 'secondary'}
            aria-pressed={status === tab}
            onClick={() => setStatus(tab)}
          >
            {t(`admin.flags.tabs.${tab}`)}
          </Button>
        ))}
      </div>

      <FormError error={error} />
      {isPending && <p role="status">{t('common.loading')}</p>}
      {!isPending && data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('admin.flags.none')}</p>
      )}

      <ul className="divide-y rounded-md border">
        {data.map((flag) => (
          <li key={flag.id} className="space-y-2 p-3 text-sm">
            <p className="font-medium">
              {flag.section?.label ?? flag.department.code} ·{' '}
              {t(`cr.flag.categories.${flag.category}`)}
            </p>
            <p>{flag.description}</p>
            <p className="text-muted-foreground">
              {t('admin.flags.raisedBy', {
                name: flag.raised_by.name,
                date: formatDhaka(flag.created_at),
              })}
            </p>
            {flag.student && (
              <p className="text-muted-foreground">
                {t('admin.flags.student', { name: flag.student.name })}
              </p>
            )}
            {flag.reply && <p>{t('admin.flags.reply', { reply: flag.reply })}</p>}
            {flag.status === 'open' && <ResolveForm flag={flag} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
