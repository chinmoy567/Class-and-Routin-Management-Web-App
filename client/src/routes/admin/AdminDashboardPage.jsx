// Spec 18, ADM-01 to ADM-11: the admin home page. One call to the server; the cards show what it returns.
import { useState } from 'react';
import { useIsSuperAdmin } from '@/features/auth/hooks.js';
import { useAdminDashboard } from '@/features/admin/hooks.js';
import {
  DepartmentFilter,
  FlagsCard,
  JoinRequestsNeedAdminCard,
  MissingAdminCard,
  RecentActivityCard,
  RejectionsCard,
  RoutineProblemsCard,
  SemesterCard,
  TeacherRegistrationsCard,
  UnconfirmedCard,
} from '@/features/admin/components/DashboardCards.jsx';
import { RoomRequestsCard } from '@/features/room-requests/components/RoomRequestsCard.jsx';
import { t } from '@/lib/i18n';

export function AdminDashboardPage() {
  const isSuper = useIsSuperAdmin();
  const [departmentId, setDepartmentId] = useState(null);
  const { data, isPending, isError } = useAdminDashboard(departmentId);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-semibold">{t('admin.dashboard.title')}</h1>
        {isSuper && <DepartmentFilter value={departmentId} onChange={setDepartmentId} />}
      </div>

      {isPending && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('errors.INTERNAL')}
        </p>
      )}

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <TeacherRegistrationsCard id="card-registrations" card={data.teacher_registrations} />
          <JoinRequestsNeedAdminCard id="card-join-requests" card={data.join_requests} />
          <FlagsCard id="card-flags" card={data.flags} />
          <RejectionsCard id="card-rejections" card={data.rejections_and_appeals} />
          <RoutineProblemsCard id="card-routine" card={data.routine_problems} />
          {/* ADM-06: released with spec 19 (R2); the server sends the data only once it is released */}
          {data.room_requests ? <RoomRequestsCard card={data.room_requests} /> : null}
          <SemesterCard id="card-semester" semester={data.semester} />
          {data.missing_admin && (
            <MissingAdminCard id="card-missing-admin" missing={data.missing_admin} />
          )}
          <UnconfirmedCard id="card-unconfirmed" card={data.unconfirmed} />
          <RecentActivityCard id="card-recent" card={data.recent_activity} />
        </div>
      )}
    </section>
  );
}
