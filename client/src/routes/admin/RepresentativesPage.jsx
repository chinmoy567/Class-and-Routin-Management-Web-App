import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button.jsx';
import { fetchAdminSemesters } from '@/features/admin/api.js';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { LastSemesterCard } from '@/features/representatives/components/LastSemesterCard.jsx';
import { ReappointResult } from '@/features/representatives/components/ReappointResult.jsx';
import { RepresentativeSlots } from '@/features/representatives/components/RepresentativeSlots.jsx';
import { SectionReadinessList } from '@/features/representatives/components/SectionReadinessList.jsx';
import { StudentSearchDialog } from '@/features/representatives/components/StudentSearchDialog.jsx';
import {
  useAssign,
  useReappoint,
  useRemove,
  useSectionReps,
  useSummary,
} from '@/features/representatives/hooks.js';
import {
  DepartmentPicker,
  useAdminDepartment,
} from '@/features/teachers/components/useAdminDepartment.jsx';
import { t } from '@/lib/i18n';
import { qk } from '@/lib/query-keys';

function RemoveConfirm({ rep, removing, error, onCancel, onConfirm }) {
  const role = t(`representatives.${rep.role}`);
  return (
    <div
      role="dialog"
      aria-labelledby="rep-remove-title"
      className="space-y-3 rounded-md border p-4"
    >
      <h3 id="rep-remove-title" className="font-medium">
        {t('representatives.removeConfirm', { name: rep.full_name, role })}
      </h3>
      <p className="text-sm">{t('representatives.removeConfirmBody', { role })}</p>
      <FormError error={error} />
      <div className="flex gap-2">
        <Button type="button" disabled={removing} onClick={onConfirm}>
          {removing ? t('representatives.removing') : t('representatives.remove')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('representatives.cancel')}
        </Button>
      </div>
    </div>
  );
}

function SectionDetail({ sectionId, departmentId }) {
  const reps = useSectionReps(sectionId);
  const assign = useAssign();
  const remove = useRemove();
  const reappoint = useReappoint();
  const [adding, setAdding] = useState(null); // 'cr' | 'dcr'
  const [removing, setRemoving] = useState(null);
  const [result, setResult] = useState(null);

  if (reps.isPending && !reps.error) return <p>{t('representatives.loading')}</p>;
  if (reps.error) {
    return (
      <div className="space-y-2">
        <FormError error={reps.error} />
        <Button type="button" variant="secondary" onClick={() => reps.refetch()}>
          {t('representatives.retry')}
        </Button>
      </div>
    );
  }
  const { section, semester_status: status, representatives, last_semester: last } = reps.data;
  const editable = status === 'draft' || status === 'current';

  return (
    <div className="space-y-6">
      <section aria-labelledby="rep-slots" className="space-y-3">
        <h2 id="rep-slots" className="text-lg font-medium">
          {t('representatives.slots', { name: section.name })}
        </h2>
        {status === 'draft' && <p className="text-sm">{t('representatives.draftNote')}</p>}
        <RepresentativeSlots
          reps={representatives}
          editable={editable && !adding && !removing}
          onAssign={(role) => {
            assign.reset();
            setAdding(role);
          }}
          onRemove={(rep) => {
            remove.reset();
            setRemoving(rep);
          }}
        />
        {adding && (
          <StudentSearchDialog
            key={adding}
            role={adding}
            departmentId={departmentId}
            pending={assign.isPending}
            onAssign={(student) =>
              assign.mutate(
                { sectionId, user_id: student.id, role: adding },
                { onSuccess: () => setAdding(null) },
              )
            }
            error={assign.error}
            onClose={() => setAdding(null)}
          />
        )}
        {removing && (
          <RemoveConfirm
            rep={removing}
            removing={remove.isPending}
            error={remove.error}
            onCancel={() => setRemoving(null)}
            onConfirm={() =>
              remove.mutate(removing.role_id, { onSuccess: () => setRemoving(null) })
            }
          />
        )}
      </section>
      <LastSemesterCard
        last={last}
        editable={editable}
        working={reappoint.isPending}
        onReappoint={() => reappoint.mutate(sectionId, { onSuccess: setResult })}
      />
      <FormError error={reappoint.error} />
      {result && <ReappointResult result={result} />}
    </div>
  );
}

function sectionKey(s) {
  return s.section_id;
}
function isDraft(s) {
  return s.status === 'draft';
}

/** Spec 09: choose each section's CR and DCRs, and re-appoint last semester's people. */
export function RepresentativesPage() {
  const { choices, departmentId, setChosen } = useAdminDepartment();
  const semesters = useQuery({
    queryKey: qk.adminSemesters(),
    queryFn: fetchAdminSemesters,
    retry: false,
  });
  const usable = (semesters.data ?? []).filter((s) => ['draft', 'current'].includes(s.status));
  const [chosenSemester, setChosenSemester] = useState('');
  const semesterId = chosenSemester || usable.find(isDraft)?.id || usable[0]?.id || '';
  const summary = useSummary(semesterId, departmentId);
  const [sectionId, setSectionId] = useState('');
  const sections = summary.data ?? [];
  const known = new Set(sections.map(sectionKey));
  const selected = known.has(sectionId) ? sectionId : '';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('representatives.title')}</h1>
      <DepartmentPicker id="rep-dept" choices={choices} value={departmentId} onChange={setChosen} />
      {semesters.isSuccess && usable.length === 0 ? (
        <p>{t('representatives.noSemester')}</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <label htmlFor="rep-semester" className="block text-sm font-medium">
              {t('representatives.semester')}
            </label>
            <select
              id="rep-semester"
              value={semesterId}
              onChange={(e) => {
                setChosenSemester(e.target.value);
                setSectionId('');
              }}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-72"
            >
              {usable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {summary.isPending && summary.fetchStatus !== 'idle' && (
            <p>{t('representatives.loading')}</p>
          )}
          <FormError error={summary.error} />
          {summary.isSuccess && (
            <SectionReadinessList
              sections={sections}
              selectedId={selected}
              onSelect={setSectionId}
            />
          )}
          {selected ? (
            <SectionDetail key={selected} sectionId={selected} departmentId={departmentId} />
          ) : (
            summary.isSuccess &&
            sections.length > 0 && <p className="text-sm">{t('representatives.pick')}</p>
          )}
        </>
      )}
    </div>
  );
}
