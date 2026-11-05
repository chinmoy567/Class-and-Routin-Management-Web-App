import { Link, useParams } from 'react-router';
import { isReleased } from '@crm/shared';
import { errorMessage } from '@/features/auth/components/FormError.jsx';
import { CrHeader } from '@/features/cr/components/CrHeader.jsx';
import { FlagsCard } from '@/features/cr/components/FlagsCard.jsx';
import { JoinRequestsCard } from '@/features/cr/components/JoinRequestsCard.jsx';
import { RosterCard } from '@/features/cr/components/RosterCard.jsx';
import { SectionRoutineCard } from '@/features/cr/components/SectionRoutineCard.jsx';
import { UnconfirmedCard } from '@/features/cr/components/UnconfirmedCard.jsx';
import { useCrOverview, useCrRoutine } from '@/features/cr/hooks.js';
import { FreeRoomsFinder } from '@/features/rooms/components/FreeRoomsFinder.jsx';
import { MyRoomRequestsCard } from '@/features/room-requests/components/MyRoomRequestsCard.jsx';
import { t } from '@/lib/i18n';

/** Spec 17: the CR/DCR dashboard for one section, in one column on phones. */
export function CrDashboardPage() {
  const { id } = useParams();
  const overview = useCrOverview(id);
  const routine = useCrRoutine(id);
  // BKG-01: a CR or DCR requests rooms for their own section (spec 19, from R2)
  const canRequest = isReleased('cr.room_requests');
  const requestTargets = canRequest ? [{ id, label: t('roomRequests.form.ownSection') }] : null;

  if (overview.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('cr.loading')}
      </p>
    );
  }
  if (overview.isError) {
    const hidden = overview.error?.status === 404;
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-md border p-3 text-sm">
          {hidden ? t('cr.notFound') : errorMessage(overview.error)}
        </p>
        <Link to="/" className="text-sm underline">
          {t('cr.back')}
        </Link>
      </div>
    );
  }

  const data = overview.data;
  return (
    <div className="space-y-4">
      <CrHeader overview={data} />
      <JoinRequestsCard
        sectionId={id}
        pending={data.join_requests.pending}
        readOnly={data.join_requests.read_only}
        groups={data.groups}
      />
      <RosterCard sectionId={id} roster={data.roster} groups={data.groups} />
      <UnconfirmedCard sectionId={id} unconfirmed={data.unconfirmed} />
      <SectionRoutineCard routine={routine.data} />
      <section aria-labelledby="cr-rooms-title" className="rounded-lg border bg-background p-4">
        <h2 id="cr-rooms-title" className="mb-2 text-base font-semibold">
          {t('cr.rooms.heading')}
        </h2>
        <FreeRoomsFinder requestTargets={requestTargets} />
      </section>
      {canRequest ? <MyRoomRequestsCard /> : null}
      <FlagsCard sectionId={id} flags={data.flags} roster={data.roster} />
    </div>
  );
}
