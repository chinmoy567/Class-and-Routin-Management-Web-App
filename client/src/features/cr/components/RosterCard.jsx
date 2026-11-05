import { useId } from 'react';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import { t } from '@/lib/i18n';
import { useChangeGroup } from '../hooks.js';
import { isReleased } from '@crm/shared';
import { StartChatButton } from '@/features/chat/components/StartChatButton.jsx';

const selectClass = 'min-h-11 rounded-md border bg-background px-3 text-sm';

/** CRD-DSH-03, CRD-DSH-10: the section's students, with their group, which the CR or DCR can change. */
export function RosterCard({ sectionId, roster, groups }) {
  const id = useId();
  const change = useChangeGroup(sectionId);
  return (
    <DashboardCard id={id} title={`${t('cr.roster.heading')} (${roster.length})`}>
      {roster.length === 0 ? (
        <CardMessage>{t('cr.roster.empty')}</CardMessage>
      ) : (
        <ul className="space-y-2">
          {roster.map((s) => (
            <li
              key={s.enrolment_id}
              className="flex flex-wrap items-center gap-3 rounded-md border p-2"
            >
              {s.photo_url && (
                <img src={s.photo_url} alt="" className="size-8 rounded-full object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.uv_id ? t('cr.roster.uv').replace('{id}', s.uv_id) : t('cr.roster.noUv')}
                  {' · '}
                  {s.confirmed ? t('cr.roster.confirmed') : t('cr.roster.notConfirmed')}
                </p>
              </div>
              <label htmlFor={`${id}-${s.enrolment_id}`} className="sr-only">
                {t('cr.roster.groupFor').replace('{name}', s.name)}
              </label>
              <select
                id={`${id}-${s.enrolment_id}`}
                value={s.group_id ?? ''}
                disabled={change.isPending}
                onChange={(e) =>
                  change.mutate({ id: s.enrolment_id, groupId: e.target.value || null })
                }
                className={selectClass}
              >
                <option value="">{t('cr.join.noGroup')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
              {isReleased('chat.app') ? <StartChatButton userId={s.user_id} /> : null}
            </li>
          ))}
        </ul>
      )}
      <FormError error={change.error} />
    </DashboardCard>
  );
}
