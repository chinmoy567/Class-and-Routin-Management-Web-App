import { t } from '@/lib/i18n';
import { FreeRoomsFinder } from '@/features/rooms/components/FreeRoomsFinder.jsx';

/** FRV-01 to FRV-06: pick a date and a range, see which rooms are free. Read-only. */
export function FreeRoomsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('freeRooms.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('freeRooms.intro')}</p>
      </header>
      <FreeRoomsFinder />
    </div>
  );
}
