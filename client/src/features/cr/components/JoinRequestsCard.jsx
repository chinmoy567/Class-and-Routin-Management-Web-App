import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import { t } from '@/lib/i18n';
import { useDecideRequest } from '../hooks.js';

const selectClass = 'min-h-11 rounded-md border bg-background px-3 text-sm';
const inputClass = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm';
const REASON_MIN = 5;

/** One pending request: accept (with or without a group), or reject with a reason (CRD-DSH-09). */
function PendingRequest({ sectionId, request, groups }) {
  const id = useId();
  const decide = useDecideRequest(sectionId);
  const [group, setGroup] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(null);

  const accept = () =>
    decide.mutate({
      id: request.id,
      body: group ? { decision: 'accept', group_id: group } : { decision: 'accept' },
    });

  const reject = () => {
    if (reason.trim().length < REASON_MIN) {
      setReasonError(t('cr.join.reasonShort'));
      return;
    }
    setReasonError(null);
    decide.mutate({ id: request.id, body: { decision: 'reject', reason: reason.trim() } });
  };

  return (
    <li className="space-y-2 rounded-md border p-3">
      <p className="font-medium">{request.full_name}</p>
      {request.email && <p className="text-xs text-muted-foreground">{request.email}</p>}
      {request.uv_id && (
        <p className="text-xs text-muted-foreground">
          {t('cr.roster.uv').replace('{id}', request.uv_id)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-group`} className="sr-only">
          {t('cr.join.groupFor').replace('{name}', request.full_name)}
        </label>
        <select
          id={`${id}-group`}
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          disabled={decide.isPending}
          className={selectClass}
        >
          <option value="">{t('cr.join.noGroup')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <Button type="button" onClick={accept} disabled={decide.isPending}>
          {group ? t('cr.join.acceptWithGroup') : t('cr.join.accept')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={rejecting}
          onClick={() => setRejecting((v) => !v)}
          disabled={decide.isPending}
        >
          {t('cr.join.reject')}
        </Button>
      </div>
      {rejecting && (
        <div className="space-y-2">
          <label htmlFor={`${id}-reason`} className="block text-sm font-medium">
            {t('cr.join.reasonLabel')}
          </label>
          <input
            id={`${id}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={reasonError ? 'true' : undefined}
            className={inputClass}
          />
          {reasonError && (
            <p role="alert" className="text-sm text-destructive">
              {reasonError}
            </p>
          )}
          <Button type="button" variant="destructive" onClick={reject} disabled={decide.isPending}>
            {t('cr.join.rejectConfirm')}
          </Button>
        </div>
      )}
      <FormError error={decide.error} />
    </li>
  );
}

/** CRD-DSH-09: pending requests to act on, then the rejected and escalated ones, read-only. */
export function JoinRequestsCard({ sectionId, pending, readOnly, groups }) {
  const id = useId();
  return (
    <DashboardCard id={id} title={`${t('cr.join.heading')} (${pending.length})`}>
      {pending.length === 0 ? (
        <CardMessage>{t('cr.join.empty')}</CardMessage>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => (
            <PendingRequest key={r.id} sectionId={sectionId} request={r} groups={groups} />
          ))}
        </ul>
      )}
      <h3 className="mt-4 text-sm font-medium">{t('cr.join.readOnlyHeading')}</h3>
      {readOnly.length === 0 ? (
        <CardMessage>{t('cr.join.readOnlyEmpty')}</CardMessage>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {readOnly.map((r) => (
            <li key={r.id} className="rounded-md border p-2">
              <span className="font-medium">{r.full_name}</span>{' '}
              <span className="text-muted-foreground">
                · {r.escalated ? t('cr.join.escalated') : t('cr.join.rejected')}
              </span>
              {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
