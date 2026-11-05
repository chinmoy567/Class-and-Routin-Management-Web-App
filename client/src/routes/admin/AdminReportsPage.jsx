import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useAdminReport, useAdminReports, useCloseReport } from '@/features/chat/hooks.js';
import { t } from '@/lib/i18n';
import { formatDhaka } from '@/lib/time';
import { cn } from '@/lib/utils';

const OUTCOMES = ['no_action', 'warned', 'suspended', 'message_removed'];

/**
 * SAF-05 to SAF-08: the reports routed to the caller. The list has no message text. Opening a report
 * is audited on the server, and the page says so.
 */
export function AdminReportsPage() {
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState(null);
  const list = useAdminReports(status);

  return (
    <section aria-labelledby="reports-title" className="max-w-3xl space-y-4">
      <h1 id="reports-title" className="text-2xl font-semibold">
        {t('adminReports.title')}
      </h1>

      <div role="group" aria-label={t('adminReports.title')} className="flex gap-2">
        {['open', 'closed'].map((s) => (
          <Button
            key={s}
            type="button"
            variant={status === s ? 'default' : 'secondary'}
            aria-pressed={status === s}
            onClick={() => {
              setStatus(s);
              setSelected(null);
            }}
          >
            {t(`adminReports.${s}`)}
          </Button>
        ))}
      </div>

      <FormError error={list.error} />
      {list.isPending ? (
        <p>{t('common.loading')}</p>
      ) : list.data?.length ? (
        <ul className="divide-y rounded-md border">
          {list.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="min-w-0 text-sm">
                <span className="font-medium">{t(`chat.report.categories.${r.category}`)}</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {r.about_message ? t('adminReports.aboutMessage') : t('adminReports.aboutPerson')}
                  {' · '}
                  {formatDhaka(r.created_at, 'd MMM yyyy, HH:mm')}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={selected === r.id}
                onClick={() => setSelected(r.id)}
              >
                {t('adminReports.view')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('adminReports.empty')}</p>
      )}

      {selected ? <ReportDetail id={selected} /> : null}
    </section>
  );
}

/** SAF-06, SAF-07, SAF-08: one report with its context, and the form to close it while it is open. */
function ReportDetail({ id }) {
  const headingId = useId();
  const report = useAdminReport(id);
  const close = useCloseReport();
  const [outcome, setOutcome] = useState('no_action');
  const [note, setNote] = useState('');

  if (report.isPending) return <p>{t('common.loading')}</p>;
  if (report.error) return <FormError error={report.error} />;
  const r = report.data;

  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-lg border p-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {t(`chat.report.categories.${r.category}`)} · {r.target.full_name}
      </h2>
      <p role="note" className="rounded-md bg-secondary p-3 text-sm">
        {t('adminReports.auditNotice')}
      </p>
      <p className="text-sm">
        <span className="font-medium">{t('adminReports.note')}: </span>
        {r.note || t('adminReports.noNote')}
      </p>

      {r.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('adminReports.personOnly')}</p>
      ) : (
        <ol aria-label={t('adminReports.reported')} className="space-y-2">
          {r.messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                'rounded-md border p-2 text-sm',
                m.reported && 'border-primary bg-secondary',
              )}
            >
              <p className="text-xs text-muted-foreground">
                {m.sender_name} · {formatDhaka(m.created_at, 'd MMM, HH:mm')}
                {m.reported ? ` · ${t('adminReports.reported')}` : ''}
              </p>
              <p className="break-words whitespace-pre-wrap">
                {m.body ?? (m.deleted ? t('adminReports.deleted') : '')}
              </p>
            </li>
          ))}
        </ol>
      )}

      {r.status === 'closed' ? (
        <p className="text-sm">
          {t('adminReports.closedAs').replace('{outcome}', t(`adminReports.outcomes.${r.outcome}`))}
        </p>
      ) : (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            close.mutate({ id: r.id, outcome, note: note.trim() || undefined });
          }}
        >
          <h3 className="text-base font-semibold">{t('adminReports.closeTitle')}</h3>
          <label className="block text-sm font-medium" htmlFor={`${headingId}-outcome`}>
            {t('adminReports.outcome')}
          </label>
          <select
            id={`${headingId}-outcome`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
          >
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {t(`adminReports.outcomes.${o}`)}
              </option>
            ))}
          </select>
          <label className="block text-sm font-medium" htmlFor={`${headingId}-note`}>
            {t('adminReports.outcomeNote')}
          </label>
          <textarea
            id={`${headingId}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <FormError error={close.error} />
          <Button type="submit" disabled={close.isPending}>
            {t('adminReports.submit')}
          </Button>
        </form>
      )}
    </section>
  );
}
