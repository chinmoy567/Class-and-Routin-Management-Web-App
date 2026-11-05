import { useId } from 'react';
import { Link } from 'react-router';
import { t } from '@/lib/i18n';
import { FreeRoomsFinder } from '@/features/rooms/components/FreeRoomsFinder.jsx';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';

/**
 * DSH-08, DSH-14: rooms free right now, view only. Teachers also get the date and time picker of
 * the free-room view, right on the dashboard.
 */
export function RoomsCard({ freeNow, isTeacher, requestTargets = null }) {
  const id = useId();
  return (
    <DashboardCard id={id} title={t('dashboard.rooms')}>
      {freeNow &&
        (freeNow.free_count ? (
          <>
            <p className="text-sm">
              {t('dashboard.roomsCount').replace('{count}', freeNow.free_count)}
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {freeNow.rooms.map((room) => (
                <li key={room.id} className="rounded-md border px-2 py-1 text-sm">
                  {room.code}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <CardMessage>{t('dashboard.roomsNone')}</CardMessage>
        ))}
      {isTeacher ? (
        <div className="mt-4 flex flex-col gap-4">
          <FreeRoomsFinder requestTargets={requestTargets} />
        </div>
      ) : (
        <Link to="/rooms/free" className="mt-3 inline-block text-sm underline">
          {t('dashboard.roomsSeeAll')}
        </Link>
      )}
    </DashboardCard>
  );
}
