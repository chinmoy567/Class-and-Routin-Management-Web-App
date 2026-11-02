import { Link } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { hhmm } from '../dates.js';
import { useFreeNow } from '../hooks.js';

const SHOWN = 5;

function isFreeRoom(room) {
  return room.status === 'free';
}

/** FRV-07: "Free rooms now" for the dashboards. Lists only the free rooms, and links to the page. */
export function FreeRoomsNowCard() {
  const { data, isPending, isError } = useFreeNow();

  let body;
  if (isPending) {
    body = <p className="text-sm text-muted-foreground">{t('freeRooms.loading')}</p>;
  } else if (isError) {
    body = <p className="text-sm text-destructive">{t('freeRooms.loadError')}</p>;
  } else {
    const free = data.rooms.filter(isFreeRoom);
    body = free.length ? (
      <>
        <p className="text-sm">
          {t('freeRooms.cardFree', { count: free.length, time: hhmm(data.to) })}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {free.slice(0, SHOWN).map((room) => (
            <li key={room.id} className="rounded-md border px-2 py-1 text-sm">
              {room.code}
            </li>
          ))}
        </ul>
      </>
    ) : (
      <p className="text-sm text-muted-foreground">{t('freeRooms.cardNone')}</p>
    );
  }

  return (
    <section aria-labelledby="free-rooms-now" className="rounded-lg border p-4">
      <h2 id="free-rooms-now" className="mb-2 text-base font-semibold">
        {t('freeRooms.cardTitle')}
      </h2>
      {body}
      <Link to="/rooms/free" className="mt-3 inline-block text-sm underline">
        {t('freeRooms.seeAll')}
      </Link>
    </section>
  );
}
