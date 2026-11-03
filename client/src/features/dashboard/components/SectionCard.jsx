import { useId } from 'react';
import { Link } from 'react-router';
import { t } from '@/lib/i18n';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';

const roleLabel = (role) => (role === 'cr' ? t('dashboard.roleCr') : t('dashboard.roleDcr'));

/** DSH-09: the student's section, its CR and DCRs, and the courses of their own group. */
export function SectionCard({ section, representatives, courses }) {
  const id = useId();
  if (!section) return null;
  return (
    <DashboardCard id={id} title={section.name}>
      {section.group && (
        <p className="mb-2 text-sm text-muted-foreground">
          {t('dashboard.groupLabel').replace('{g}', section.group)}
        </p>
      )}

      <h3 className="mt-3 text-sm font-medium">{t('dashboard.representatives')}</h3>
      {representatives?.length ? (
        <ul className="mt-1 space-y-1 text-sm">
          {representatives.map((r) => (
            <li key={`${r.role}-${r.user_id}`}>
              {r.name} <span className="text-muted-foreground">({roleLabel(r.role)})</span>
            </li>
          ))}
        </ul>
      ) : (
        <CardMessage>{t('dashboard.noRepresentatives')}</CardMessage>
      )}

      <h3 className="mt-3 text-sm font-medium">{t('dashboard.courses')}</h3>
      {courses?.length ? (
        <ul className="mt-1 space-y-1 text-sm">
          {courses.map((c) => (
            <li key={c.course_code}>
              {c.course_code}
              {c.course_name ? ` — ${c.course_name}` : ''}
              {c.teachers?.length > 0 && (
                <span className="text-muted-foreground">
                  {' · '}
                  {c.teachers.map((tc) => tc.full_name).join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <CardMessage>{t('dashboard.noCourses')}</CardMessage>
      )}

      {section.my_role && (
        <Link to="/cr" className="mt-3 inline-block text-sm underline">
          {t('dashboard.myRoleLink')}
        </Link>
      )}
    </DashboardCard>
  );
}
