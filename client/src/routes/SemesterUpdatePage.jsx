import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useGraduate, useNotEnrolled, useSemesterUpdate } from '@/features/rollover/hooks.js';
import { JoinPage } from '@/routes/JoinPage.jsx';
import { t } from '@/lib/i18n';

/** ROL-09, ROL-10: the two choices that are not a join request. */
function OtherChoices({ data }) {
  const graduate = useGraduate();
  const notEnrolled = useNotEnrolled();
  const busy = graduate.isPending || notEnrolled.isPending;

  function onGraduate() {
    if (window.confirm(t('semesterUpdate.graduateConfirm'))) graduate.mutate();
  }
  function onNotEnrolled() {
    if (window.confirm(t('semesterUpdate.notEnrolledConfirm'))) notEnrolled.mutate();
  }

  return (
    <div className="space-y-3">
      {data.not_enrolled && <p role="status">{t('semesterUpdate.notEnrolledDone')}</p>}
      {data.can_graduate && (
        <Button variant="secondary" className="w-full" disabled={busy} onClick={onGraduate}>
          {t('semesterUpdate.graduate')}
        </Button>
      )}
      {!data.not_enrolled && (
        <Button variant="secondary" className="w-full" disabled={busy} onClick={onNotEnrolled}>
          {t('semesterUpdate.notEnrolled')}
        </Button>
      )}
      <FormError error={graduate.error ?? notEnrolled.error} />
    </div>
  );
}

/**
 * SPEC 14, ROL-08 to ROL-11: the semester update screen. The join form, pre-filled from last
 * semester, plus "I have completed my degree" and "Not enrolled this semester".
 */
export function SemesterUpdatePage() {
  const update = useSemesterUpdate();

  if (update.isPending) return <p>{t('common.loading')}</p>;
  if (update.error) return <FormError error={update.error} />;

  const data = update.data;
  const semesterName = data.semester?.name ?? '';
  const lastLabel = data.last_section
    ? `${data.last_section.level}-${data.last_section.term}-${data.last_section.letter}`
    : null;

  return (
    <JoinPage
      prefill={data.prefill}
      title={t('semesterUpdate.title')}
      intro={
        <>
          {t('semesterUpdate.intro', { semester: semesterName })}
          {lastLabel && ` ${t('semesterUpdate.lastTerm', { label: lastLabel })}`}
        </>
      }
      footer={<OtherChoices data={data} />}
    />
  );
}
