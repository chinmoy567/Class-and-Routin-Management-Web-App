// Spec 19, BKG-12 to BKG-16: the decision queue. An admin of a department that owns or shares a room
// approves or rejects each request. The first decision is final; if someone else decided first, the
// server answers ALREADY_DECIDED and the queue refreshes.
import { isReleased } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { hhmm } from '@/features/rooms/dates.js';
import {
  useAdminRoomRequests,
  useDecideRoomRequest,
  useRoomRequestSocket,
} from '@/features/room-requests/hooks.js';
import { errorMessage } from '@/features/auth/components/FormError.jsx';

/** The booking wording for a refused decision (ALREADY_DECIDED first), else the general one. */
function decisionError(error) {
  const key = `roomRequests.errors.${error?.code}`;
  if (error instanceof ApiError && t(key) !== key) return t(key);
  return errorMessage(error);
}

function RequestRow({ request, onDecide, busy }) {
  const others = request.other_requests ?? [];
  return (
    <li className="space-y-2 py-3">
      <p className="font-medium">{request.requester_label}</p>
      <p className="text-sm">{request.note}</p>
      {others.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('roomRequests.queue.otherRequests', { count: others.length })}
        </p>
      )}
      {(request.requester_no_shows ?? []).map((n) => (
        <p key={`${n.date}-${n.note}`} className="text-xs text-muted-foreground">
          {t('roomRequests.queue.noShow', { date: n.date, note: n.note })}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => onDecide(request.id, 'approve')}>
          {t('roomRequests.queue.approve')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => onDecide(request.id, 'reject')}
        >
          {t('roomRequests.queue.reject')}
        </Button>
      </div>
    </li>
  );
}

export function AdminRoomRequestsPage() {
  const released = isReleased('admin.room_requests');
  const queue = useAdminRoomRequests('pending', released);
  const decide = useDecideRoomRequest();
  useRoomRequestSocket();

  if (!released) {
    return (
      <section className="space-y-2 p-4">
        <h1 className="text-xl font-semibold">{t('roomRequests.queue.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('roomRequests.queue.notReleased')}</p>
      </section>
    );
  }

  const onDecide = (id, decision) => decide.mutate({ id, decision });

  return (
    <section className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">{t('roomRequests.queue.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('roomRequests.queue.intro')}</p>
      {decide.isError && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {decisionError(decide.error)}
        </p>
      )}
      {queue.isPending && <p className="text-sm">{t('roomRequests.queue.loading')}</p>}
      {queue.isError && <p className="text-sm">{t('roomRequests.queue.error')}</p>}
      {queue.data && !queue.data.groups.length && (
        <p className="text-sm text-muted-foreground">{t('roomRequests.queue.empty')}</p>
      )}
      {queue.data?.groups.map((group) => (
        <section
          key={`${group.room_id}-${group.date}-${group.start}`}
          aria-label={`${group.room_code} ${group.date}`}
          className="rounded-md border p-4"
        >
          <h2 className="text-base font-semibold">
            {t('roomRequests.queue.slot', {
              room: group.room_code,
              date: group.date,
              start: hhmm(group.start),
              end: hhmm(group.end),
            })}
          </h2>
          <ul className="divide-y">
            {group.requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                onDecide={onDecide}
                busy={decide.isPending && decide.variables?.id === request.id}
              />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
