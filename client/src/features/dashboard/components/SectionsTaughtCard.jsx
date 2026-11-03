import { useId, useState } from 'react';
import { t } from '@/lib/i18n';
import { useSectionRoster } from '../hooks.js';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';

function RosterRows({ sectionId }) {
  const { data, isPending, isError } = useSectionRoster(sectionId, true);
  if (isPending) return <CardMessage>{t('dashboard.rosterLoading')}</CardMessage>;
  if (isError) return <CardMessage>{t('dashboard.rosterError')}</CardMessage>;
  if (!data.length) return <CardMessage>{t('dashboard.rosterEmpty')}</CardMessage>;
  return (
    <ul className="mt-2 divide-y text-sm">
      {data.map((row) => (
        <li key={row.user_id} className="flex flex-wrap justify-between gap-2 py-2">
          <span className="font-medium">{row.name}</span>
          <span className="text-muted-foreground">
            {row.uv_id ?? t('dashboard.noUvId')} ·{' '}
            {row.group
              ? t('dashboard.groupLabel').replace('{g}', row.group)
              : t('dashboard.noGroup')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One section the teacher teaches. Its roster is fetched only when it is opened (DSH-13). */
function SectionRoster({ section }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{section.name}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="min-h-11 rounded-md border px-3 text-sm"
        >
          {open ? t('dashboard.hideRoster') : t('dashboard.showRoster')}
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('dashboard.students').replace('{count}', section.student_count)}
      </p>
      <div id={panelId} hidden={!open}>
        {open && <RosterRows sectionId={section.section_id} />}
      </div>
    </li>
  );
}

/** DSH-13: the sections the teacher teaches, each with its roster on demand. */
export function SectionsTaughtCard({ sections }) {
  const id = useId();
  return (
    <DashboardCard id={id} title={t('dashboard.sectionsTaught')}>
      {!sections?.length ? (
        <CardMessage>{t('dashboard.noSections')}</CardMessage>
      ) : (
        <ul className="divide-y">
          {sections.map((s) => (
            <SectionRoster key={s.section_id} section={s} />
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
