import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button.jsx';
import { fetchAdminSemesters } from '@/features/admin/api.js';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { DiffView } from '@/features/imports/components/DiffView.jsx';
import { IssueList } from '@/features/imports/components/IssueList.jsx';
import { PublishDialog } from '@/features/imports/components/PublishDialog.jsx';
import { SectionPreview } from '@/features/imports/components/SectionPreview.jsx';
import { UploadCard } from '@/features/imports/components/UploadCard.jsx';
import {
  useConfirmIssue,
  useImports,
  usePreview,
  usePublishImport,
  useSaveKeepChoices,
  useUploadImport,
} from '@/features/imports/hooks.js';
import {
  DepartmentPicker,
  useAdminDepartment,
} from '@/features/teachers/components/useAdminDepartment.jsx';
import { t } from '@/lib/i18n';
import { qk } from '@/lib/query-keys';

function ImportBody({ id }) {
  const preview = usePreview(id);
  const confirm = useConfirmIssue();
  const keep = useSaveKeepChoices();
  const publish = usePublishImport();
  const [dialog, setDialog] = useState(false);
  const [done, setDone] = useState(false);

  if (preview.isPending) return <p>{t('imports.loading')}</p>;
  if (preview.isError) {
    return (
      <div className="space-y-2">
        <FormError error={preview.error} />
        <Button type="button" variant="secondary" onClick={() => preview.refetch()}>
          {t('imports.retry')}
        </Button>
      </div>
    );
  }
  const { import: imp, sections, issues, diff } = preview.data;
  const isOpen = imp.status === 'checked';
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning' && !i.confirmed).length;

  function choose(slotId, value) {
    const choices = {};
    for (const s of diff.removed) if (s.edited_by_hand) choices[s.id] = s.choice;
    for (const { slot } of diff.changed) if (slot.edited_by_hand) choices[slot.id] = slot.choice;
    keep.mutate({ id, choices: { ...choices, [slotId]: value } });
  }
  function doPublish(reviewed) {
    publish.mutate(
      { id, warningsReviewed: reviewed },
      {
        onSuccess: () => {
          setDialog(false);
          setDone(true);
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <p>
        <strong>{t(`imports.status.${imp.status}`)}</strong>
        {' · '}
        {t('imports.summary', { rows: imp.counts.rows ?? 0, errors, warnings })}
      </p>
      <IssueList
        issues={issues}
        canConfirm={isOpen}
        confirming={confirm.isPending}
        onConfirm={(issueId) => confirm.mutate({ id, issueId })}
      />
      <FormError error={confirm.error} />
      {sections.length > 0 && <SectionPreview sections={sections} />}
      {diff && <DiffView diff={diff} onChoose={choose} saving={keep.isPending} />}
      <FormError error={keep.error} />
      {done && <p role="status">{t('imports.publishedPlain')}</p>}
      {isOpen && !done && (
        <div className="space-y-2">
          {errors > 0 ? (
            <p className="text-sm text-muted-foreground">{t('imports.blockedByErrors')}</p>
          ) : dialog ? (
            <PublishDialog
              warnings={warnings}
              publishing={publish.isPending}
              error={publish.error}
              onCancel={() => setDialog(false)}
              onConfirm={doPublish}
            />
          ) : (
            <Button type="button" onClick={() => setDialog(true)}>
              {t('imports.publish')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function RoutineImportPage() {
  const { choices, departmentId, setChosen } = useAdminDepartment();
  const semesters = useQuery({
    queryKey: qk.adminSemesters(),
    queryFn: fetchAdminSemesters,
    retry: false,
  });
  const usable = (semesters.data ?? []).filter((s) => ['draft', 'current'].includes(s.status));
  const [chosenSemester, setChosenSemester] = useState('');
  const semesterId =
    chosenSemester || usable.find((s) => s.status === 'current')?.id || usable[0]?.id || '';
  const list = useImports(semesterId, departmentId);
  const upload = useUploadImport();
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    setSelected(null);
  }, [semesterId, departmentId]);
  const importId = selected ?? list.data?.open_import_id ?? null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('imports.title')}</h1>
      <DepartmentPicker
        id="import-dept"
        choices={choices}
        value={departmentId}
        onChange={setChosen}
      />
      {semesters.isSuccess && usable.length === 0 ? (
        <p>{t('imports.noSemester')}</p>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="import-semester" className="block text-sm font-medium">
            {t('imports.semester')}
          </label>
          <select
            id="import-semester"
            value={semesterId}
            onChange={(e) => setChosenSemester(e.target.value)}
            className="h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-72"
          >
            {usable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {semesterId && departmentId && (
        <>
          <UploadCard
            departmentId={departmentId}
            upload={{
              isPending: upload.isPending,
              error: upload.error,
              mutate: (vars, opts) => upload.mutate({ semesterId, departmentId, ...vars }, opts),
            }}
            onUploaded={setSelected}
          />
          {list.isPending ? (
            <p>{t('imports.loading')}</p>
          ) : importId ? (
            <ImportBody key={importId} id={importId} />
          ) : (
            <p className="text-muted-foreground">{t('imports.empty')}</p>
          )}
        </>
      )}
    </div>
  );
}
