import { Button } from '@/components/ui/button.jsx';
import { BookingClashDialog } from './BookingClashDialog.jsx';
import { t } from '@/lib/i18n';

/** EDT-04: the second step. Warnings never block; the admin confirms and the form is re-sent. */
export function WarningsStep({
  warnings,
  bookings,
  combineWith,
  onCombine,
  bookingAction,
  onBookingAction,
  saving,
  onConfirm,
  onBack,
}) {
  const offer = warnings.find((w) => w.offer_combined);
  const needsBooking = bookings.length > 0 && !bookingAction;
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{t('routineEdit.warnings.title')}</h3>
      <p className="text-sm">{t('routineEdit.warnings.body')}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {warnings.map((w, i) => (
          <li key={`${w.code}-${i}`}>{w.message}</li>
        ))}
      </ul>
      {offer && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={combineWith === offer.other_slot_id}
            onChange={(e) => onCombine(e.target.checked ? offer.other_slot_id : null)}
          />
          {t('routineEdit.warnings.combine')}
        </label>
      )}
      {bookings.length > 0 && (
        <BookingClashDialog bookings={bookings} value={bookingAction} onChange={onBookingAction} />
      )}
      <div className="flex gap-2">
        <Button type="button" disabled={saving || needsBooking} onClick={onConfirm}>
          {t('routineEdit.warnings.confirm')}
        </Button>
        <Button type="button" variant="secondary" onClick={onBack}>
          {t('routineEdit.warnings.back')}
        </Button>
      </div>
    </div>
  );
}
