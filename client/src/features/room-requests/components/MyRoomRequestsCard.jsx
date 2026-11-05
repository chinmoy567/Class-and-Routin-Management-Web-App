import { useId } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button.jsx';
import { errorMessage } from '@/features/auth/components/FormError.jsx';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import { hhmm } from '@/features/rooms/dates.js';
import { t } from '@/lib/i18n';
import { useCancelRoomRequest, useMyRoomRequests } from '../hooks.js';

const CANCELLABLE = ['pending', 'approved'];

/** BKG-26: the requester's own requests with their status and reason. Cancel is offered while open. */
export function MyRoomRequestsCard() {
  const id = useId();
  const mine = useMyRoomRequests(true);
  const cancel = useCancelRoomRequest();

  return (
    <DashboardCard id={id} title={t('roomRequests.mine.title')}>
      {mine.isPending && <CardMessage>{t('roomRequests.mine.loading')}</CardMessage>}
      {mine.isError && <CardMessage>{t('roomRequests.mine.error')}</CardMessage>}
      {mine.data && !mine.data.length && <CardMessage>{t('roomRequests.mine.empty')}</CardMessage>}
      {mine.data?.length > 0 && (
        <ul className="divide-y text-sm">
          {mine.data.map((request) => (
            <li key={request.id} className="space-y-1 py-2">
              <p className="font-medium">
                {t('roomRequests.mine.line', {
                  room: request.room_code,
                  date: request.date,
                  start: hhmm(request.start),
                  end: hhmm(request.end),
                })}
              </p>
              <p className="text-muted-foreground">
                {t(`roomRequests.status.${request.status}`)}
                {request.reason ? ` · ${request.reason}` : ''}
              </p>
              {CANCELLABLE.includes(request.status) && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate({ id: request.id })}
                >
                  {t('roomRequests.mine.cancel')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {cancel.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {errorMessage(cancel.error)}
        </p>
      )}
      <Link to="/rooms/free" className="mt-3 inline-block text-sm underline">
        {t('roomRequests.mine.findRoom')}
      </Link>
    </DashboardCard>
  );
}
