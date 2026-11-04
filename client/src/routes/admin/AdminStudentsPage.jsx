// Spec 18, ADM-12 to ADM-17 and ADM-21: find a student and act on them. The server checks every action; the
// buttons shown here only follow the student's state.
import { useId, useState } from 'react';
import { useIsSuperAdmin } from '@/features/auth/hooks.js';
import { FormError, errorMessage } from '@/features/auth/components/FormError.jsx';
import { Button } from '@/components/ui/button.jsx';
import { ConfirmDialog } from '@/features/admin/components/ConfirmDialog.jsx';
import { TempPasswordDialog } from '@/features/admin/components/TempPasswordDialog.jsx';
import { DepartmentFilter } from '@/features/admin/components/DashboardCards.jsx';
import {
  useDeactivateStudent,
  useGraduateStudent,
  useIssueTempPassword,
  useReactivateStudent,
  useRemoveFromSection,
  useSectionGroups,
  useSetStudentGroup,
  useStudentSearch,
  useUngraduateStudent,
} from '@/features/admin/hooks.js';
import { t } from '@/lib/i18n';

const TEMP_PASSWORD_STATES = ['claim_pending', 'unconfirmed', 'active', 'graduated'];

/** The group picker for one student. Loads the section's groups from the CR overview. */
function GroupPicker({ student }) {
  const id = useId();
  const groups = useSectionGroups(student.section?.id);
  const save = useSetStudentGroup();
  const [groupId, setGroupId] = useState(student.group?.id ?? '');
  const list = groups.data?.groups ?? [];
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ enrolmentId: student.enrolment.id, group_id: groupId || null });
      }}
    >
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium">
          {t('admin.students.groupLabel')}
        </label>
        <select
          id={id}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="min-h-11 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">{t('admin.students.groupNone')}</option>
          {list.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" disabled={save.isPending}>
        {t('admin.students.groupSave')}
      </Button>
      <FormError error={save.error} />
      {save.isSuccess && (
        <p role="status" className="text-sm">
          {t('admin.students.done')}
        </p>
      )}
    </form>
  );
}

function StudentRow({ student, onTemp, onConfirm }) {
  const graduate = useGraduateStudent();
  const ungraduate = useUngraduateStudent();
  const reactivate = useReactivateStudent();
  const temp = useIssueTempPassword();
  const { state } = student;
  const canTemp = TEMP_PASSWORD_STATES.includes(state);
  return (
    <li className="space-y-3 p-3">
      <div className="flex items-start gap-3">
        {student.photo_url ? (
          <img src={student.photo_url} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <span aria-hidden="true" className="size-12 rounded-full bg-muted" />
        )}
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">{student.full_name}</p>
          <p className="text-muted-foreground">
            {student.uv_id ? t('admin.students.uvId', { uvId: student.uv_id }) : ''}
          </p>
          <p className="text-muted-foreground">
            {t('admin.students.state', { state: t(`admin.students.states.${state}`) })} ·{' '}
            {t(`admin.students.emailStatus.${student.email_status}`)}
          </p>
          {student.section && (
            <p className="text-muted-foreground">
              {t('admin.students.section', { section: student.section.label })}
              {student.group
                ? ` · ${t('admin.students.group', { group: student.group.label })}`
                : ''}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {state === 'deactivated' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={reactivate.isPending}
            onClick={() => reactivate.mutate(student.id)}
          >
            {t('admin.students.actions.reactivate')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onConfirm({ kind: 'deactivate', student })}
          >
            {t('admin.students.actions.deactivate')}
          </Button>
        )}
        {(state === 'active' || state === 'unconfirmed') && (
          <Button
            type="button"
            variant="secondary"
            disabled={graduate.isPending}
            onClick={() => graduate.mutate(student.id)}
          >
            {t('admin.students.actions.graduate')}
          </Button>
        )}
        {state === 'graduated' && (
          <Button
            type="button"
            variant="secondary"
            disabled={ungraduate.isPending}
            onClick={() => ungraduate.mutate(student.id)}
          >
            {t('admin.students.actions.ungraduate')}
          </Button>
        )}
        {canTemp && (
          <Button
            type="button"
            variant="secondary"
            disabled={temp.isPending}
            onClick={() =>
              temp.mutate(student.id, {
                onSuccess: (data) =>
                  onTemp({ name: student.full_name, password: data.temp_password }),
              })
            }
          >
            {t('admin.students.actions.tempPassword')}
          </Button>
        )}
        {student.enrolment?.status === 'accepted' && student.section && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onConfirm({ kind: 'remove', student })}
          >
            {t('admin.students.actions.removeFromSection')}
          </Button>
        )}
      </div>
      <FormError error={graduate.error ?? ungraduate.error ?? reactivate.error ?? temp.error} />

      {student.enrolment?.status === 'accepted' && student.section && (
        <GroupPicker student={student} />
      )}
    </li>
  );
}

export function AdminStudentsPage() {
  const isSuper = useIsSuperAdmin();
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [shownPassword, setShownPassword] = useState(null);
  const search = useStudentSearch({ q, department_id: departmentId });
  const deactivate = useDeactivateStudent();
  const remove = useRemoveFromSection();
  const searchId = useId();

  const rows = search.data ?? [];
  function closeDialog() {
    setDialog(null);
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('admin.students.title')}</h1>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor={searchId} className="block text-sm font-medium">
            {t('admin.students.searchLabel')}
          </label>
          <input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
            aria-describedby={`${searchId}-hint`}
          />
          <p id={`${searchId}-hint`} className="text-sm text-muted-foreground">
            {t('admin.students.searchHint')}
          </p>
        </div>
        {isSuper && <DepartmentFilter value={departmentId} onChange={setDepartmentId} />}
      </div>

      <FormError error={search.error} />
      {q.trim().length >= 2 && !search.isPending && rows.length === 0 && !search.error && (
        <p className="text-sm text-muted-foreground">{t('admin.students.none')}</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y rounded-md border">
          {rows.map((student) => (
            <StudentRow
              key={student.id}
              student={student}
              onTemp={setShownPassword}
              onConfirm={setDialog}
            />
          ))}
        </ul>
      )}

      {dialog?.kind === 'deactivate' && (
        <ConfirmDialog
          title={t('admin.students.actions.deactivate')}
          body={t('admin.students.confirmDeactivate', { name: dialog.student.full_name })}
          confirmLabel={t('admin.students.actions.deactivate')}
          withReason
          pending={deactivate.isPending}
          error={errorMessage(deactivate.error)}
          onCancel={closeDialog}
          onConfirm={(reason) =>
            deactivate.mutate({ id: dialog.student.id, reason }, { onSuccess: closeDialog })
          }
        />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          title={t('admin.students.actions.removeFromSection')}
          body={t('admin.students.confirmRemove', {
            name: dialog.student.full_name,
            section: dialog.student.section.label,
          })}
          confirmLabel={t('admin.students.actions.removeFromSection')}
          withReason
          reasonLabel={t('admin.students.removeReason')}
          pending={remove.isPending}
          error={errorMessage(remove.error)}
          onCancel={closeDialog}
          onConfirm={(reason) =>
            remove.mutate(
              { enrolmentId: dialog.student.enrolment.id, reason },
              { onSuccess: closeDialog },
            )
          }
        />
      )}
      {shownPassword && (
        <TempPasswordDialog
          name={shownPassword.name}
          password={shownPassword.password}
          onClose={() => setShownPassword(null)}
        />
      )}
    </section>
  );
}
