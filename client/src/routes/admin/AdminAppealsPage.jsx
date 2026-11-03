// Spec 18, ADM-04 and ADM-16: rejected join requests and open appeals. An appeal is decided with the spec 10
// endpoint: accept the request (reverse the rejection) or uphold it.
import { useState } from 'react';
import { useIsSuperAdmin } from '@/features/auth/hooks.js';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { Button } from '@/components/ui/button.jsx';
import { DepartmentFilter } from '@/features/admin/components/DashboardCards.jsx';
import { useDecideAppeal, useJoinList } from '@/features/admin/hooks.js';
import { formatDhaka } from '@/lib/time';
import { t } from '@/lib/i18n';

export function AdminAppealsPage() {
  const isSuper = useIsSuperAdmin();
  const [departmentId, setDepartmentId] = useState(null);
  const appeals = useJoinList({ view: 'appeals', department_id: departmentId });
  const rejected = useJoinList({ view: 'rejected', department_id: departmentId });
  const decide = useDecideAppeal();
  const open = appeals.data ?? [];
  const openIds = new Set(open.map((a) => a.id));
  const closed = (rejected.data ?? []).filter((r) => !openIds.has(r.id));
  const error = appeals.error ?? rejected.error;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-semibold">{t('admin.appeals.title')}</h1>
        {isSuper && <DepartmentFilter value={departmentId} onChange={setDepartmentId} />}
      </div>

      <FormError error={error} />
      <FormError error={decide.error} />
      {decide.isSuccess && (
        <p role="status" className="text-sm">
          {t('admin.appeals.done')}
        </p>
      )}
      {open.length + closed.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">{t('admin.appeals.none')}</p>
      )}

      <ul className="divide-y rounded-md border">
        {[...open, ...closed].map((r) => (
          <li key={r.id} className="space-y-2 p-3 text-sm">
            <p className="font-medium">{r.full_name}</p>
            <p className="text-muted-foreground">
              {r.department?.code} · {r.section?.label ?? ''} · {formatDhaka(r.created_at)}
            </p>
            {r.reason && <p>{t('admin.appeals.reason', { reason: r.reason })}</p>}
            {r.appeal?.status === 'open' ? (
              <>
                <p className="font-medium">{t('admin.appeals.appealOpen')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ enrolmentId: r.id, decision: 'reverse' })}
                  >
                    {t('admin.appeals.reverse')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ enrolmentId: r.id, decision: 'uphold' })}
                  >
                    {t('admin.appeals.uphold')}
                  </Button>
                </div>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
