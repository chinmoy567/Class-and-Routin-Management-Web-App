import { useState } from 'react';
import { t } from '@/lib/i18n';
import { formatDhaka, serverNow } from '@/lib/time';
import { useDepartments } from '@/features/auth/hooks.js';
import { useAvailability, useAvailabilitySocket } from '@/features/rooms/hooks.js';
import { RoomStatusGroups } from '@/features/rooms/components/RoomStatusGroups.jsx';
import { hhmm, timeOptions, weekBounds } from '@/features/rooms/dates.js';

const selectClass = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm';
const TEN_AM = 600;
const ELEVEN_AM = 660;

/** FRV-01 to FRV-06: pick a date and a range, see which rooms are free. Read-only. */
export function FreeRoomsPage() {
  useAvailabilitySocket();
  const today = formatDhaka(serverNow(), 'yyyy-MM-dd');
  const { min, max } = weekBounds(today);
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(TEN_AM);
  const [to, setTo] = useState(ELEVEN_AM);
  const [type, setType] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const departments = useDepartments(true);

  const rangeOk = from < to;
  const query = useAvailability(
    rangeOk && date
      ? { date, from, to, type: type || undefined, departmentId: departmentId || undefined }
      : null,
  );
  const data = query.data;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('freeRooms.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('freeRooms.intro')}</p>
      </header>

      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => e.preventDefault()}
        aria-label={t('freeRooms.title')}
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('freeRooms.date')}
          <input
            type="date"
            className={selectClass}
            value={date}
            min={min}
            max={max}
            onChange={(e) => setDate(e.target.value)}
          />
          <span className="font-normal text-muted-foreground">{t('freeRooms.dateHint')}</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('freeRooms.from')}
            <select
              className={selectClass}
              value={from}
              onChange={(e) => setFrom(Number(e.target.value))}
            >
              {timeOptions('start').map((m) => (
                <option key={m} value={m}>
                  {hhmm(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('freeRooms.to')}
            <select
              className={selectClass}
              value={to}
              onChange={(e) => setTo(Number(e.target.value))}
            >
              {timeOptions('end').map((m) => (
                <option key={m} value={m}>
                  {hhmm(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('freeRooms.type')}
          <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t('freeRooms.typeAll')}</option>
            <option value="classroom">{t('freeRooms.roomType.classroom')}</option>
            <option value="lab">{t('freeRooms.roomType.lab')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('freeRooms.department')}
          <select
            className={selectClass}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">{t('freeRooms.departmentAll')}</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>
        </label>
      </form>

      {!rangeOk ? (
        <p role="alert" className="text-sm text-destructive">
          {t('freeRooms.rangeError')}
        </p>
      ) : null}
      {data && !data.requests_allowed ? (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
          {t('freeRooms.requestsOff', { label: data.day_label ?? '' })}
        </p>
      ) : null}

      {query.isPending && rangeOk ? (
        <p className="text-sm text-muted-foreground">{t('freeRooms.loading')}</p>
      ) : null}
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error?.message || t('freeRooms.loadError')}
        </p>
      ) : null}
      {data ? (
        data.rooms.length ? (
          <RoomStatusGroups rooms={data.rooms} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('freeRooms.empty')}</p>
        )
      ) : null}
    </div>
  );
}
