import { useId } from 'react';
import { Link } from 'react-router';
import { t } from '@/lib/i18n';
import { DashboardCard, CardMessage } from './DashboardCard.jsx';

/** DSH-08, DSH-14: rooms free right now, view only. Teachers also get a link to pick a time. */
export function RoomsCard({ freeNow, isTeacher }) {
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
      <Link to="/rooms/free" className="mt-3 inline-block text-sm underline">
        {isTeacher ? t('dashboard.roomsPickTime') : t('dashboard.roomsSeeAll')}
      </Link>
    </DashboardCard>
  );
}
