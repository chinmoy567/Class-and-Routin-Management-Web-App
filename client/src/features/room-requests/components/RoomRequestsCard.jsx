import { useId } from 'react';
import { Link } from 'react-router';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import { hhmm } from '@/features/rooms/dates.js';
import { t } from '@/lib/i18n';

/**
 * ADM-06: the "Room requests waiting" card. `card` is `{ count, items }` from the admin dashboard,
 * earliest decision cutoff first. The full queue is one click away.
 */
export function RoomRequestsCard({ card }) {
  const id = useId();
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.roomRequests')}>
      {card.count === 0 ? (
        <CardMessage>{t('admin.dashboard.roomRequests.none')}</CardMessage>
      ) : (
        <>
          <p className="text-sm">
            {t('admin.dashboard.roomRequests.count').replace('{count}', String(card.count))}
          </p>
          <ul className="mt-2 divide-y text-sm">
            {card.items.map((item) => (
              <li key={item.id} className="py-2">
                <span className="font-medium">{item.room_code}</span> · {item.date}{' '}
                {hhmm(item.start)}–{hhmm(item.end)} · {item.requester_label}
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/admin/room-requests" className="mt-3 inline-block text-sm underline">
        {t('admin.dashboard.roomRequests.open')}
      </Link>
    </DashboardCard>
  );
}
