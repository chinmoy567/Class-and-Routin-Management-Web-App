const pad = (n) => String(n).padStart(2, '0');
/** Minutes after midnight (institution time, already computed by the server) as HH:MM. */
export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
