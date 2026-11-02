import { t } from '@/lib/i18n';

const CHOICES = [
  ['keep_booking', 'routineEdit.warnings.keepBooking'],
  ['cancel_booking', 'routineEdit.warnings.cancelBooking'],
];

/** EDT-05: the approved bookings the change touches, and what to do with them. */
export function BookingClashDialog({ bookings, value, onChange }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('routineEdit.warnings.bookingChoice')}</legend>
      <ul className="list-disc pl-5 text-sm">
        {bookings.map((b) => (
          <li key={b.id}>
            {t('routineEdit.warnings.bookingOf', { name: b.requester_name, date: b.date })}
          </li>
        ))}
      </ul>
      {CHOICES.map(([action, key]) => (
        <label key={action} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="booking_action"
            checked={value === action}
            onChange={() => onChange(action)}
          />
          {t(key)}
        </label>
      ))}
    </fieldset>
  );
}
