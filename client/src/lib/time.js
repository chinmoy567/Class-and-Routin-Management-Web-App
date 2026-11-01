import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'Asia/Dhaka';

// Never trust the device clock: keep the offset between it and the server's time.
let offsetMs = 0;

/** Call with the `server_time` (ISO string) from any API response that carries it. */
export function setServerTime(serverIso) {
  offsetMs = new Date(serverIso).getTime() - Date.now();
}

export const serverNow = () => new Date(Date.now() + offsetMs);

export const formatDhaka = (instant, pattern = 'EEE d MMM yyyy, HH:mm') =>
  formatInTimeZone(instant, TZ, pattern);
