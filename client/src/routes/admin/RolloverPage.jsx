import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useIsSuperAdmin } from '@/features/auth/hooks.js';
import { useAdminSemesters } from '@/features/admin/hooks.js';
import { useMakeCurrent, useReadiness } from '@/features/rollover/hooks.js';
import { t } from '@/lib/i18n';

/** One ✔ or ✘ line. The word says it too, so the state is not carried by colour or icon alone. */
function Check({ ok, text }) {
  return (
    <li className="flex gap-2 text-sm">
      <span aria-hidden="true">{ok ? '✔' : '✘'}</span>
      <span>{text}</span>
    </li>
  );
}

/** ROL-01: the four checks of one department, with counts. */
function DepartmentCard({ department }) {
  const { items } = department;
  return (
    <article className="space-y-2 rounded-md border p-4" aria-labelledby={`dept-${department.id}`}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={`dept-${department.id}`} className="font-medium">
          {department.code} {department.name}
        </h2>
        <span
          className={
            department.ready ? 'text-sm font-medium' : 'text-sm font-medium text-destructive'
          }
        >
          {department.ready ? t('rollover.ready') : t('rollover.notReady')}
        </span>
      </header>
      <ul className="space-y-1">
        <Check
          ok={items.sections.ok}
          text={
            items.sections.ok
              ? t('rollover.items.sections', { count: items.sections.count })
              : t('rollover.items.noSections')
          }
        />
        <Check
          ok={items.import.ok}
          text={items.import.ok ? t('rollover.items.importOk') : t('rollover.items.importMissing')}
        />
        <Check
          ok={items.cr.ok}
          text={
            items.cr.ok
              ? t('rollover.items.crOk')
              : t('rollover.items.crMissing', {
                  without: items.cr.without_cr,
                  total: items.cr.total,
                })
          }
        />
        <Check
          ok={items.rooms.ok}
          text={
            items.rooms.ok
              ? t('rollover.items.roomsOk', { count: items.rooms.count })
              : t('rollover.items.noRooms')
          }
        />
      </ul>
    </article>
  );
}

/** Lists the departments the server says are not ready, with the reasons. */
function NotReadyList({ departments }) {
  return (
    <ul className="list-inside list-disc text-sm">
      {departments.map((d) => (
        <li key={d.code}>
          {d.code}: {d.reasons.map((r) => t(`rollover.reasons.${r}`)).join(', ')}
        </li>
      ))}
    </ul>
  );
}

/** ROL-01 to ROL-03: the readiness checklist and "Make current" for the draft semester. */
export function RolloverPage() {
  const semesters = useAdminSemesters();
  const isSuper = useIsSuperAdmin();
  const draft = semesters.data?.find((s) => s.status === 'draft');
  const readiness = useReadiness(draft?.id);
  const makeCurrent = useMakeCurrent();
  // The not-ready list the server returned, waiting for the super admin to confirm (ROL-03).
  const [notReady, setNotReady] = useState(null);

  if (semesters.isPending || (draft && readiness.isPending)) {
    return <p>{t('common.loading')}</p>;
  }
  if (semesters.error) return <FormError error={semesters.error} />;
  if (!draft) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('rollover.title')}</h1>
        <p>{t('rollover.noDraft')}</p>
      </section>
    );
  }
  if (readiness.error) return <FormError error={readiness.error} />;

  const { departments, can_make_current: canMake } = readiness.data;

  function submit(confirmNotReady) {
    makeCurrent.mutate(
      { id: draft.id, confirm_not_ready: confirmNotReady },
      {
        onSuccess: () => setNotReady(null),
        onError: (err) => {
          if (err.code === 'NOT_READY_UNCONFIRMED' && err.details?.departments) {
            setNotReady(err.details.departments);
          }
        },
      },
    );
  }

  const done = makeCurrent.data;
  // The not-ready answer is shown as the warning above, not as an error.
  const formError = makeCurrent.error?.code === 'NOT_READY_UNCONFIRMED' ? null : makeCurrent.error;

  return (
    <section className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('rollover.title')}</h1>
        <p className="text-muted-foreground">
          {t('rollover.intro')} {draft.name}
        </p>
      </header>

      {done && (
        <p role="status" className="rounded-md border p-3">
          {t('rollover.done', { name: done.name, students: done.students_unconfirmed })}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {departments.map((d) => (
          <DepartmentCard key={d.id} department={d} />
        ))}
      </div>

      {notReady && (
        <div role="alert" className="space-y-3 rounded-md border border-destructive p-4">
          <p>{t('rollover.confirmWarning', { list: notReady.map((d) => d.code).join(', ') })}</p>
          <NotReadyList departments={notReady} />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={makeCurrent.isPending}
              onClick={() => submit(notReady.map((d) => d.code))}
            >
              {t('rollover.confirmAnyway')}
            </Button>
            <Button variant="secondary" onClick={() => setNotReady(null)}>
              {t('rollover.cancel')}
            </Button>
          </div>
        </div>
      )}

      <FormError error={formError} />

      {canMake && isSuper && !notReady && (
        <Button disabled={makeCurrent.isPending} onClick={() => submit([])}>
          {t('rollover.makeCurrent')}
        </Button>
      )}
      {!canMake && <p className="text-sm text-muted-foreground">{t('rollover.notAllowed')}</p>}
    </section>
  );
}
