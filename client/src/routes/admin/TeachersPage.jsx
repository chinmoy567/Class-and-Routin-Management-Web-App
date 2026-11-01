import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import {
  DepartmentPicker,
  useAdminDepartment,
} from '@/features/teachers/components/useAdminDepartment.jsx';
import {
  useChangeAccount,
  useCreateTeacher,
  useLinkTeacher,
  useTeacherAccounts,
  useTeachers,
  useUnlinkTeacher,
} from '@/features/teachers/hooks.js';
import { t } from '@/lib/i18n';

function AddForm({ departmentId, onDone }) {
  const create = useCreateTeacher();
  const [shortCode, setShortCode] = useState('');
  const [fullName, setFullName] = useState('');
  const fields = create.error?.fields ?? {};
  function submit(event) {
    event.preventDefault();
    create.mutate(
      { department_id: departmentId, short_code: shortCode, full_name: fullName },
      { onSuccess: onDone },
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border p-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="teacher-code" className="block text-sm font-medium">
          {t('teachers.records.shortCode')}
        </label>
        <Input id="teacher-code" value={shortCode} onChange={(e) => setShortCode(e.target.value)} />
        {fields.short_code && (
          <p className="text-sm text-destructive">{t('teachers.records.fieldError.short_code')}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="teacher-name" className="block text-sm font-medium">
          {t('teachers.records.fullName')}
        </label>
        <Input id="teacher-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        {fields.full_name && (
          <p className="text-sm text-destructive">{t('teachers.records.fieldError.full_name')}</p>
        )}
      </div>
      <FormError error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>
          {t('teachers.records.create')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('teachers.cancel')}
        </Button>
      </div>
    </form>
  );
}

function LinkForm({ record, accounts }) {
  const link = useLinkTeacher();
  const [userId, setUserId] = useState('');
  const free = accounts.filter((a) => !a.linked && a.state === 'active');
  function submit(event) {
    event.preventDefault();
    if (userId) link.mutate({ id: record.id, user_id: userId });
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={`account-${record.id}`} className="block text-sm font-medium">
        {t('teachers.records.accountLabel')}
      </label>
      <div className="flex gap-2">
        <select
          id={`account-${record.id}`}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="h-11 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">{t('teachers.records.choose')}</option>
          {free.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" disabled={link.isPending || !userId}>
          {t('teachers.records.saveLink')}
        </Button>
      </div>
      <FormError error={link.error} />
    </form>
  );
}

function RecordRow({ record, accounts }) {
  const unlink = useUnlinkTeacher();
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">
            {record.short_code} · {record.full_name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {record.linked
              ? t('teachers.records.linked', { name: record.linked_user.full_name })
              : t('teachers.records.notLinked')}
          </p>
        </div>
        {record.linked && (
          <Button variant="secondary" onClick={() => unlink.mutate(record.id)}>
            {t('teachers.records.unlink')}
          </Button>
        )}
      </div>
      <FormError error={unlink.error} />
      {!record.linked && <LinkForm record={record} accounts={accounts} />}
    </li>
  );
}

function AccountRow({ account }) {
  const change = useChangeAccount();
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const fields = change.error?.fields ?? {};

  function submit(event) {
    event.preventDefault();
    const confirmKey = action === 'suspend' ? 'confirmSuspend' : 'confirmRemove';
    if (!window.confirm(t(`teachers.records.${confirmKey}`, { name: account.full_name }))) return;
    change.mutate({ userId: account.id, action, reason }, { onSuccess: () => setAction(null) });
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">{account.full_name}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`teachers.records.state.${account.state}`)}
          </p>
        </div>
        {!action && (
          <div className="flex gap-2">
            {account.state === 'active' && (
              <Button variant="secondary" onClick={() => setAction('suspend')}>
                {t('teachers.records.suspend')}
              </Button>
            )}
            {['active', 'suspended'].includes(account.state) && (
              <Button variant="destructive" onClick={() => setAction('remove')}>
                {t('teachers.records.remove')}
              </Button>
            )}
            {account.state !== 'active' && (
              <Button
                variant="secondary"
                onClick={() => change.mutate({ userId: account.id, action: 'reactivate' })}
              >
                {t('teachers.records.reactivate')}
              </Button>
            )}
          </div>
        )}
      </div>
      {action && (
        <form onSubmit={submit} className="space-y-2" noValidate>
          <label htmlFor={`why-${account.id}`} className="block text-sm font-medium">
            {t('teachers.records.reasonLabel')}
          </label>
          <Input
            id={`why-${account.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby={`why-${account.id}-hint`}
          />
          <p id={`why-${account.id}-hint`} className="text-sm text-muted-foreground">
            {t('teachers.records.reasonHint')}
          </p>
          {fields.reason && (
            <p className="text-sm text-destructive">{t('teachers.records.fieldError.reason')}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={change.isPending}>
              {t(`teachers.records.${action}`)}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAction(null)}>
              {t('teachers.cancel')}
            </Button>
          </div>
        </form>
      )}
      <FormError error={change.error} />
    </li>
  );
}

/** TCH-07 to TCH-13: records, link status, link and unlink, suspend, remove, reactivate. */
export function TeachersPage() {
  const { choices, departmentId, setChosen } = useAdminDepartment();
  const records = useTeachers(departmentId);
  const accounts = useTeacherAccounts(departmentId);
  const [adding, setAdding] = useState(false);

  if (records.isPending && departmentId) return <p>{t('common.loading')}</p>;
  if (records.error) return <FormError error={records.error} />;

  return (
    <section className="max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('teachers.records.title')}</h1>
        {!adding && departmentId && (
          <Button onClick={() => setAdding(true)}>{t('teachers.records.add')}</Button>
        )}
      </header>
      <DepartmentPicker
        id="teachers-department"
        choices={choices}
        value={departmentId}
        onChange={(id) => {
          setChosen(id);
          setAdding(false);
        }}
      />
      {adding && <AddForm departmentId={departmentId} onDone={() => setAdding(false)} />}
      {records.data?.length === 0 ? (
        <p>{t('teachers.records.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {records.data?.map((r) => (
            <RecordRow key={r.id} record={r} accounts={accounts.data ?? []} />
          ))}
        </ul>
      )}
      {accounts.data?.length > 0 && (
        <ul className="divide-y rounded-md border" aria-label={t('teachers.records.accountLabel')}>
          {accounts.data.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </ul>
      )}
    </section>
  );
}
