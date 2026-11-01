import { useState } from 'react';
import { FormError } from '@/features/auth/components/FormError.jsx';
import {
  useAdmins,
  useGrantAdminRole,
  useRemoveAdminRole,
  useResetAdminPassword,
  useResetAdminSecondStep,
  useUserSearch,
} from '@/features/admin/hooks.js';
import { useAdminDepartments } from '@/features/admin/hooks.js';
import { useMe } from '@/features/auth/hooks.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { t } from '@/lib/i18n';

function GrantPanel() {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [role, setRole] = useState('dept_admin');
  const [departmentId, setDepartmentId] = useState('');
  const search = useUserSearch(q);
  const departments = useAdminDepartments();
  const grant = useGrantAdminRole();

  function submit(event) {
    event.preventDefault();
    const body = { user_id: picked.id, role };
    if (role === 'dept_admin') body.department_id = departmentId;
    grant.mutate(body, {
      onSuccess: () => {
        setPicked(null);
        setQ('');
        setDepartmentId('');
      },
    });
  }

  return (
    <section aria-labelledby="grant-title" className="space-y-3 rounded-md border p-4">
      <h2 id="grant-title" className="text-lg font-medium">
        {t('admin.admins.grantTitle')}
      </h2>
      <div className="space-y-1.5">
        <label htmlFor="admin-search" className="block text-sm font-medium">
          {t('admin.admins.search')}
        </label>
        <Input
          id="admin-search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPicked(null);
          }}
          aria-describedby="admin-search-hint"
        />
        <p id="admin-search-hint" className="text-sm text-muted-foreground">
          {t('admin.admins.searchHint')}
        </p>
      </div>

      {!picked && search.data && (
        <ul className="divide-y rounded-md border">
          {search.data.length === 0 && <li className="p-3">{t('admin.admins.noResults')}</li>}
          {search.data.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="min-h-11 w-full px-3 py-2 text-left hover:bg-accent"
                onClick={() => setPicked(u)}
              >
                {u.full_name}
                {u.department?.code && (
                  <span className="text-muted-foreground"> · {u.department.code}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked && (
        <form onSubmit={submit} className="space-y-3">
          <p className="font-medium">{picked.full_name}</p>
          <div className="space-y-1.5">
            <label htmlFor="admin-role" className="block text-sm font-medium">
              {t('admin.admins.chooseRole')}
            </label>
            <select
              id="admin-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3"
            >
              <option value="dept_admin">{t('admin.admins.role.dept_admin')}</option>
              <option value="super_admin">{t('admin.admins.role.super_admin')}</option>
            </select>
          </div>
          {role === 'dept_admin' && (
            <div className="space-y-1.5">
              <label htmlFor="admin-dept" className="block text-sm font-medium">
                {t('admin.admins.chooseDepartment')}
              </label>
              <select
                id="admin-dept"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="min-h-11 w-full rounded-md border border-input bg-background px-3"
              >
                <option value="">{t('admin.admins.choosePlaceholder')}</option>
                {(departments.data ?? [])
                  .filter((d) => !d.retired)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} {d.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <FormError error={grant.error} />
          <Button
            type="submit"
            disabled={grant.isPending || (role === 'dept_admin' && !departmentId)}
          >
            {t('admin.admins.grant')}
          </Button>
        </form>
      )}
      {grant.isSuccess && !picked && (
        <p role="status" className="text-sm">
          {t('admin.admins.granted', { name: grant.data?.name ?? '' })}
        </p>
      )}
    </section>
  );
}

/** DEP-05 to DEP-11: who the admins are, and the tools to change that. */
export function AdminsPage() {
  const { data, isPending, error } = useAdmins();
  const me = useMe();
  const remove = useRemoveAdminRole();
  const resetPassword = useResetAdminPassword();
  const resetSecondStep = useResetAdminSecondStep();
  const [notice, setNotice] = useState(null);

  if (isPending && !error) return <p>{t('common.loading')}</p>;
  if (error) return <FormError error={error} />;
  const myId = me.data?.user?.id;

  function onRemove(admin, roleId) {
    if (window.confirm(t('admin.admins.removeConfirm', { name: admin.full_name }))) {
      remove.mutate(roleId, { onSuccess: () => setNotice(t('admin.admins.removed')) });
    }
  }

  return (
    <section className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('admin.admins.title')}</h1>

      {data.fewer_than_two_super_admins && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
          {t('admin.admins.warning')}
        </p>
      )}

      <GrantPanel />

      <FormError error={remove.error ?? resetPassword.error ?? resetSecondStep.error} />
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}

      {data.admins.length === 0 ? (
        <p>{t('admin.admins.none')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.admins.map((a) => {
            const self = a.user_id === myId;
            return (
              <li key={a.user_id} className="space-y-3 p-3">
                <p className="font-medium">
                  {a.full_name}{' '}
                  {self && <span className="font-normal">{t('admin.admins.you')}</span>}
                </p>
                <ul className="space-y-2">
                  {a.roles.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {t(`admin.admins.role.${r.role}`)} ·{' '}
                        {r.department
                          ? `${r.department.code} ${r.department.name}`
                          : t('admin.admins.universityWide')}
                      </span>
                      {!self && (
                        <Button variant="destructive" onClick={() => onRemove(a, r.id)}>
                          {t('admin.admins.remove')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {!self && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        resetPassword.mutate(a.user_id, {
                          onSuccess: () =>
                            setNotice(t('admin.admins.resetPasswordDone', { name: a.full_name })),
                        })
                      }
                    >
                      {t('admin.admins.resetPassword')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        resetSecondStep.mutate(a.user_id, {
                          onSuccess: () =>
                            setNotice(t('admin.admins.resetSecondStepDone', { name: a.full_name })),
                        })
                      }
                    >
                      {t('admin.admins.resetSecondStep')}
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
