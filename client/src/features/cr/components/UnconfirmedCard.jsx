import { useId } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import { t } from '@/lib/i18n';
import { useSendReminder } from '../hooks.js';

function nameOf(list, id) {
  return list.find((u) => u.id === id)?.name;
}

/** CRD-DSH-04: students who have not done the semester update, with one reminder a day each. */
export function UnconfirmedCard({ sectionId, unconfirmed }) {
  const id = useId();
  const remind = useSendReminder(sectionId);
  const sentTo = remind.isSuccess ? nameOf(unconfirmed, remind.variables) : null;

  return (
    <DashboardCard id={id} title={`${t('cr.unconfirmed.heading')} (${unconfirmed.length})`}>
      <CardMessage>{t('cr.unconfirmed.hint')}</CardMessage>
      {unconfirmed.length === 0 ? (
        <CardMessage>{t('cr.unconfirmed.empty')}</CardMessage>
      ) : (
        <ul className="mt-2 space-y-2">
          {unconfirmed.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
            >
              <div>
                <p className="font-medium">{u.name}</p>
                <p className="text-xs text-muted-foreground">
                  {u.applied ? t('cr.unconfirmed.applied') : t('cr.unconfirmed.notApplied')}
                </p>
              </div>
              {u.can_remind ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={remind.isPending}
                  onClick={() => remind.mutate(u.id)}
                  aria-label={t('cr.unconfirmed.remindFor').replace('{name}', u.name)}
                >
                  {t('cr.unconfirmed.remind')}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('cr.unconfirmed.notRemindable')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {sentTo && (
        <p role="status" className="mt-2 text-sm">
          {t('cr.unconfirmed.sent').replace('{name}', sentTo)}
        </p>
      )}
      <FormError error={remind.error} />
    </DashboardCard>
  );
}
