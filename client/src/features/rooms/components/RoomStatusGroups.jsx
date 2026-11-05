import { t } from '@/lib/i18n';

// FRV-05: the groups in the order the page shows them. Each heading is a text label, not a colour.
const GROUPS = ['free', 'unknown', 'busy', 'booked'];

/**
 * The rooms grouped Free / Availability unknown / In use / Booked, with a legend (FRV-05).
 * `onRequest` is given only to users who may request a room (BKG-01); free rooms then get a button.
 */
export function RoomStatusGroups({ rooms, onRequest }) {
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-2 text-sm sm:grid-cols-2" aria-label={t('freeRooms.legend')}>
        {GROUPS.map((status) => (
          <div key={status} className="flex gap-2">
            <dt className="font-medium">{t(`freeRooms.groups.${status}`)}:</dt>
            <dd className="text-muted-foreground">{t(`freeRooms.statusHelp.${status}`)}</dd>
          </div>
        ))}
      </dl>
      {GROUPS.map((status) => {
        const list = rooms.filter((room) => room.status === status);
        const headingId = `room-group-${status}`;
        return (
          <section key={status} aria-labelledby={headingId}>
            <h2 id={headingId} className="mb-2 text-base font-semibold">
              {t(`freeRooms.groups.${status}`)} ({list.length})
            </h2>
            {list.length ? (
              <ul className="divide-y rounded-md border">
                {list.map((room) => (
                  <li key={room.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                    <span className="font-medium">{room.code}</span>
                    <span className="text-sm text-muted-foreground">
                      {t(`freeRooms.roomType.${room.type}`)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('freeRooms.owner', { code: room.owner.code })}
                    </span>
                    {status === 'unknown' ? (
                      <span className="text-sm">{t('freeRooms.unknownNote')}</span>
                    ) : null}
                    {onRequest && status === 'free' && room.requests_allowed !== false ? (
                      <button
                        type="button"
                        onClick={() => onRequest(room)}
                        aria-label={t('roomRequests.requestFor', { room: room.code })}
                        className="ms-auto min-h-11 rounded-md border px-3 text-sm"
                      >
                        {t('roomRequests.request')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('freeRooms.none')}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
