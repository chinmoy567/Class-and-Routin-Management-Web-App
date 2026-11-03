// Spec 18, ADM-01 to ADM-10: the cards of the admin home page. Each card shows what the server returned for
// the admin's scope. Actions go through the same endpoints the owning specs use, so the server checks them.
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button.jsx';
import { DashboardCard, CardMessage } from '@/features/dashboard/components/DashboardCard.jsx';
import {
  useAdminDepartments,
  useDecideAppeal,
  useDecideEscalatedJoin,
  useDecideOwnClaim,
  useDecideRegistrationFromDashboard,
} from '../hooks.js';
import { formatDhaka } from '@/lib/time';
import { t } from '@/lib/i18n';
import { deactivateBody } from '@crm/shared';

const listClass = 'divide-y rounded-md border';
const rowClass = 'space-y-2 p-3 text-sm';
const selectClass = 'min-h-11 rounded-md border bg-background px-3 text-sm';

/** The department picker, shown to a super admin only. "All" is the empty choice. */
export function DepartmentFilter({ value, onChange }) {
  const id = useId();
  const { data: departments = [] } = useAdminDepartments();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {t('admin.dashboard.department')}
      </label>
      <select
        id={id}
        className={selectClass}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{t('admin.dashboard.allDepartments')}</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A reason field with its own validation (5 to 500 characters), for a rejection. */
function RejectForm({ onSubmit, pending, label }) {
  const id = useId();
  const [reason, setReason] = useState('');
  const valid = deactivateBody.safeParse({ reason: reason.trim() }).success;
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit(reason.trim());
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {t('admin.dashboard.rejectReason')}
      </label>
      <textarea
        id={id}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={500}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      {reason.trim().length > 0 && !valid && (
        <p className="text-sm text-destructive">{t('admin.dashboard.rejectReasonError')}</p>
      )}
      <Button type="submit" variant="secondary" disabled={!valid || pending}>
        {label}
      </Button>
    </form>
  );
}

function Empty({ count }) {
  if (count !== 0) return null;
  return <CardMessage>{t('admin.dashboard.nothing')}</CardMessage>;
}

/** ADM-01: pending teacher registrations, approve or reject inline. The email is never sent to this card. */
export function TeacherRegistrationsCard({ id, card }) {
  const decide = useDecideRegistrationFromDashboard();
  const [rejecting, setRejecting] = useState(null);
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.teacherRegistrations')}>
      <Empty count={card.count} />
      <ul className={listClass}>
        {card.items.map((r) => (
          <li key={r.id} className={rowClass}>
            <p className="font-medium">{r.full_name}</p>
            <p className="text-muted-foreground">
              {r.department?.code} · {r.requested_short_code}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r.id, decision: 'approve' })}
              >
                {t('admin.dashboard.approve')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setRejecting(r.id)}>
                {t('admin.dashboard.reject')}
              </Button>
            </div>
            {rejecting === r.id && (
              <RejectForm
                label={t('admin.dashboard.reject')}
                pending={decide.isPending}
                onSubmit={(reason) => decide.mutate({ id: r.id, decision: 'reject', reason })}
              />
            )}
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

/** ADM-02: escalated join requests and CR/DCR UV ID claims. The admin decides them here. */
export function IdClaimsCard({ id, card }) {
  const escalated = useDecideEscalatedJoin();
  const claim = useDecideOwnClaim();
  const [rejecting, setRejecting] = useState(null);
  const pending = escalated.isPending || claim.isPending;
  const decideItem = (item, body) => {
    if (item.kind === 'escalated') escalated.mutate({ enrolmentId: item.id, ...body });
    else
      claim.mutate({
        claimId: item.id,
        ...(body.decision === 'accept' ? { decision: 'approve' } : body),
      });
  };
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.idClaims')}>
      <Empty count={card.count} />
      <ul className={listClass}>
        {card.items.map((item) => (
          <li key={`${item.kind}-${item.id}`} className={rowClass}>
            <p className="font-medium">{item.full_name}</p>
            <p className="text-muted-foreground">
              {t(`admin.dashboard.itemKinds.${item.kind === 'claim' ? 'claim' : 'escalated'}`)}
              {item.uv_id ? ` · UV ID ${item.uv_id}` : ''}
              {item.duplicate_pending_claim ? ` · ${t('admin.dashboard.duplicateClaim')}` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending}
                onClick={() => decideItem(item, { decision: 'accept' })}
              >
                {t('admin.dashboard.approve')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRejecting(`${item.kind}-${item.id}`)}
              >
                {t('admin.dashboard.reject')}
              </Button>
            </div>
            {rejecting === `${item.kind}-${item.id}` && (
              <RejectForm
                label={t('admin.dashboard.reject')}
                pending={pending}
                onSubmit={(reason) => decideItem(item, { decision: 'reject', reason })}
              />
            )}
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

/** ADM-03: open reports from CR and DCR. */
export function FlagsCard({ id, card }) {
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.flags')}>
      <Empty count={card.count} />
      <ul className={listClass}>
        {card.items.map((f) => (
          <li key={f.id} className={rowClass}>
            <p className="font-medium">{f.section?.label ?? f.department?.code}</p>
            <p className="text-muted-foreground">
              {t('admin.flags.raisedBy', {
                name: f.raised_by.name,
                date: formatDhaka(f.created_at),
              })}
            </p>
          </li>
        ))}
      </ul>
      {card.count > 0 && (
        <Link className="mt-2 inline-block text-sm underline" to="/admin/flags">
          {t('admin.dashboard.viewAll')}
        </Link>
      )}
    </DashboardCard>
  );
}

/** ADM-04: open appeals first (accept or uphold), then the rejections. */
export function RejectionsCard({ id, card }) {
  const decide = useDecideAppeal();
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.rejections')}>
      <Empty count={card.count} />
      <ul className={listClass}>
        {card.items.map((r) => (
          <li key={`${r.kind}-${r.id}`} className={rowClass}>
            <p className="font-medium">{r.full_name}</p>
            <p className="text-muted-foreground">
              {t(`admin.dashboard.itemKinds.${r.kind}`)}
              {r.reason ? ` · ${t('admin.appeals.reason', { reason: r.reason })}` : ''}
            </p>
            {r.kind === 'appeal' && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ enrolmentId: r.id, decision: 'reverse' })}
                >
                  {t('admin.appeals.reverse')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ enrolmentId: r.id, decision: 'uphold' })}
                >
                  {t('admin.appeals.uphold')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

/** ADM-05: open import issues, duplicates with another department and sections another import created. */
export function RoutineProblemsCard({ id, card }) {
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.routineProblems')}>
      <Empty count={card.count} />
      <ul className={listClass}>
        {card.items.map((i, index) => (
          <li key={index} className={rowClass}>
            <p className="font-medium">
              {t(`admin.dashboard.itemKinds.${i.kind === 'issue' ? 'issue' : i.kind}`, {
                department: i.created_by_department,
              })}
            </p>
            <p className="text-muted-foreground">{i.message ?? i.section?.label}</p>
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

/** ADM-07: the current semester, and the readiness of a draft. "Make current" is on the rollover page. */
export function SemesterCard({ id, semester }) {
  const readiness = semester.readiness;
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.semester')}>
      {semester.current ? (
        <p className="text-sm">
          {t('admin.dashboard.semester.current', {
            name: semester.current.name,
            status: semester.current.status,
          })}
        </p>
      ) : (
        <CardMessage>{t('admin.dashboard.semester.none')}</CardMessage>
      )}
      {semester.draft && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">
            {t('admin.dashboard.semester.draft', { name: semester.draft.name })}
          </p>
          <ul className={listClass}>
            {readiness?.departments.map((d) => (
              <li key={d.id} className="flex items-center justify-between p-3 text-sm">
                <span>{d.code}</span>
                <span>
                  {d.ready
                    ? t('admin.dashboard.semester.ready')
                    : t('admin.dashboard.semester.notReady')}
                </span>
              </li>
            ))}
          </ul>
          {readiness?.can_make_current && (
            <Link className="inline-block text-sm underline" to="/admin/rollover">
              {t('admin.dashboard.semester.makeCurrent')}
            </Link>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

/** ADM-08: super admin only. Departments with no active admin, and the two-super-admin warning. */
export function MissingAdminCard({ id, missing }) {
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.missingAdmin')}>
      {missing.fewer_than_two_super_admins && (
        <p
          role="alert"
          className="mb-2 rounded-md border border-destructive p-2 text-sm text-destructive"
        >
          {t('admin.dashboard.superWarning')}
        </p>
      )}
      <Empty count={missing.departments.count} />
      <ul className="list-disc pl-5 text-sm">
        {missing.departments.items.map((d) => (
          <li key={d.id}>
            {d.code} {d.name}
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

/** ADM-09: students still unconfirmed 14 days after the semester became current, per section. */
export function UnconfirmedCard({ id, card }) {
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.unconfirmed')}>
      <Empty count={card.count} />
      <ul className={listClass}>
        {card.items.map((g) => (
          <li key={g.section.id} className={rowClass}>
            <p className="font-medium">{g.section.label}</p>
            <p className="text-muted-foreground">{g.students.map((s) => s.name).join(', ')}</p>
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

/** ADM-10: the latest audit entries in scope. */
export function RecentActivityCard({ id, card }) {
  return (
    <DashboardCard id={id} title={t('admin.dashboard.cards.recent')}>
      <Empty count={card.count} />
      <ul className={listClass}>
        {card.items.map((e) => (
          <li key={e.id} className={rowClass}>
            <p className="font-medium">{e.action}</p>
            <p className="text-muted-foreground">
              {formatDhaka(e.at)} · {e.actor_name}
            </p>
          </li>
        ))}
      </ul>
      <Link className="mt-2 inline-block text-sm underline" to="/admin/audit">
        {t('admin.dashboard.viewAll')}
      </Link>
    </DashboardCard>
  );
}
