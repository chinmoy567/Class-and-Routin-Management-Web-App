import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button.jsx';
import { fetchAdminSemesters } from '@/features/admin/api.js';
import { useCurrentSemester } from '@/features/admin/hooks.js';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { CancelClassDialog } from '@/features/calendar/components/CancelClassDialog.jsx';
import { DeleteConfirm } from '@/features/routine-edit/components/DeleteConfirm.jsx';
import { SectionManager } from '@/features/routine-edit/components/SectionManager.jsx';
import { SlotDialog } from '@/features/routine-edit/components/SlotDialog.jsx';
import { WeekGrid } from '@/features/routine-edit/components/WeekGrid.jsx';
import {
  useCreateSlot,
  useDeleteSlot,
  useGrid,
  useSections,
  useUpdateSlot,
} from '@/features/routine-edit/hooks.js';
import {
  DepartmentPicker,
  useAdminDepartment,
} from '@/features/teachers/components/useAdminDepartment.jsx';
import { t } from '@/lib/i18n';
import { qk } from '@/lib/query-keys';

function inBatch(list, batch) {
  return batch ? list.filter((s) => s.department_id === batch) : list;
}

function pick(list, id) {
  return list.find((s) => s.id === id) ?? list[0];
}

const selectClass = 'h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-72';

function Picker({ id, label, value, onChange, children }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
      >
        {children}
      </select>
    </div>
  );
}

function Editor({ semesterId, section, departmentId }) {
  const grid = useGrid(section.id);
  const create = useCreateSlot();
  const update = useUpdateSlot();
  const del = useDeleteSlot();
  const [dialog, setDialog] = useState(null); // { slot } where slot is null when adding
  const [deleting, setDeleting] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [cancelling, setCancelling] = useState(null); // a slot, while its cancel dialog is open
  const currentSemester = useCurrentSemester().data ?? null;

  if (grid.isPending) return <p>{t('routineEdit.loading')}</p>;
  if (grid.isError) {
    return (
      <div className="space-y-2">
        <FormError error={grid.error} />
        <Button type="button" variant="secondary" onClick={() => grid.refetch()}>
          {t('routineEdit.retry')}
        </Button>
      </div>
    );
  }
  const { section: info, slots } = grid.data;
  const open = ['draft', 'current'].includes(info.semester_status);

  function closeDialog(result) {
    setDialog(null);
    setConflict(Boolean(result?.conflict)); // EDT-09: the grid was reloaded by the mutation
  }
  const save = (body) =>
    dialog.slot
      ? update.mutateAsync({ id: dialog.slot.id, version: dialog.slot.version, ...body })
      : create.mutateAsync({
          semester_id: semesterId,
          section_id: section.id,
          department_id: departmentId || undefined,
          ...body,
        });

  return (
    <div className="space-y-6">
      {conflict && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
          {t('routineEdit.conflict')}
        </p>
      )}
      {open && !dialog && !deleting && (
        <Button type="button" onClick={() => setDialog({ slot: null })}>
          {t('routineEdit.addSlot')}
        </Button>
      )}
      {dialog && (
        <SlotDialog
          key={dialog.slot?.id ?? 'new'}
          slot={dialog.slot}
          groups={info.groups}
          save={save}
          onClose={closeDialog}
        />
      )}
      {deleting && (
        <DeleteConfirm
          slot={deleting}
          deleting={del.isPending}
          error={del.error}
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            del.mutate(
              { id: deleting.id, version: deleting.version },
              {
                onSuccess: () => setDeleting(null),
                onError: (err) => {
                  if (err.code === 'CONFLICT') {
                    setDeleting(null);
                    setConflict(true);
                  }
                },
              },
            )
          }
        />
      )}
      {cancelling && currentSemester && (
        <CancelClassDialog
          key={cancelling.id}
          slot={cancelling}
          semester={currentSemester}
          onClose={() => setCancelling(null)}
        />
      )}
      <WeekGrid
        slots={slots}
        onEdit={(slot) => {
          setConflict(false);
          setDialog({ slot });
        }}
        onDelete={(slot) => {
          setConflict(false);
          del.reset();
          setDeleting(slot);
        }}
        onCancelClass={
          info.semester_status === 'current' && currentSemester
            ? (slot) => setCancelling(slot)
            : undefined
        }
      />
      {open && (
        <SectionManager semesterId={semesterId} departmentId={departmentId} section={info} />
      )}
    </div>
  );
}

/** Spec 08: edit single slots of one section of a draft or current semester. */
export function RoutineEditPage() {
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
  const sections = useSections(semesterId);
  const [batch, setBatch] = useState('');
  const [chosenSection, setChosenSection] = useState('');
  const all = sections.data ?? [];
  const batches = [...new Map(all.map((s) => [s.department_id, s.department_code])).entries()];
  const shown = inBatch(all, batch);
  const section = pick(shown, chosenSection);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('routineEdit.title')}</h1>
      <DepartmentPicker
        id="edit-dept"
        choices={choices}
        value={departmentId}
        onChange={setChosen}
      />
      {semesters.isSuccess && usable.length === 0 ? (
        <p>{t('routineEdit.noSemester')}</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          <Picker
            id="edit-semester"
            label={t('routineEdit.semester')}
            value={semesterId}
            onChange={setChosenSemester}
          >
            {usable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Picker>
          <Picker id="edit-batch" label={t('routineEdit.batch')} value={batch} onChange={setBatch}>
            <option value="">{t('routineEdit.allBatches')}</option>
            {batches.map(([id, code]) => (
              <option key={id} value={id}>
                {code}
              </option>
            ))}
          </Picker>
          <Picker
            id="edit-section"
            label={t('routineEdit.section')}
            value={section?.id ?? ''}
            onChange={setChosenSection}
          >
            {shown.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Picker>
        </div>
      )}
      <FormError error={sections.error} />
      {semesterId && sections.isSuccess && !section && (
        <>
          <p className="text-muted-foreground">{t('routineEdit.noSections')}</p>
          <SectionManager semesterId={semesterId} departmentId={departmentId} section={null} />
        </>
      )}
      {section && (
        <Editor
          key={section.id}
          semesterId={semesterId}
          section={section}
          departmentId={departmentId}
        />
      )}
    </div>
  );
}
