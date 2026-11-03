// Spec 18, ADM-19: the audit log, read-only. There is no edit or delete control anywhere on this page.
import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useAuditLog } from '@/features/admin/hooks.js';
import { fetchAuditLog } from '@/features/admin/api.js';
import { qk } from '@/lib/query-keys';
import { formatDhaka } from '@/lib/time';
import { t } from '@/lib/i18n';

const EMPTY = { from: '', to: '', action: '', actor_id: '', target_id: '' };

const inputClass = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm';

function Field({ name, label, value, onChange, type = 'text' }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

export function AdminAuditPage() {
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState({});
  const [extra, setExtra] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const queryClient = useQueryClient();
  const page = useAuditLog(filters);

  const first = page.data?.entries ?? [];
  const entries = [...first, ...extra];
  const nextCursor = extra.length ? cursor : page.data?.next_cursor;

  function apply(event) {
    event.preventDefault();
    const clean = Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim() !== ''));
    setExtra([]);
    setCursor(null);
    setFilters(clean);
  }

  async function loadMore() {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await queryClient.fetchQuery({
        queryKey: qk.adminAudit({ ...filters, cursor: nextCursor }),
        queryFn: () => fetchAuditLog({ ...filters, cursor: nextCursor }),
      });
      setExtra((rows) => [...rows, ...next.entries]);
      setCursor(next.next_cursor);
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('admin.audit.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('admin.audit.readOnly')}</p>

      <form onSubmit={apply} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          name="from"
          label={t('admin.audit.from')}
          type="date"
          value={draft.from}
          onChange={set('from')}
        />
        <Field
          name="to"
          label={t('admin.audit.to')}
          type="date"
          value={draft.to}
          onChange={set('to')}
        />
        <Field
          name="action"
          label={t('admin.audit.action')}
          value={draft.action}
          onChange={set('action')}
        />
        <Field
          name="actor_id"
          label={t('admin.audit.actor')}
          value={draft.actor_id}
          onChange={set('actor_id')}
        />
        <Field
          name="target_id"
          label={t('admin.audit.target')}
          value={draft.target_id}
          onChange={set('target_id')}
        />
        <div>
          <Button type="submit">{t('admin.audit.apply')}</Button>
        </div>
      </form>

      <FormError error={page.error} />
      {moreError && <FormError error={moreError} />}
      {page.isPending && <p role="status">{t('common.loading')}</p>}
      {!page.isPending && entries.length === 0 && !page.error && (
        <p className="text-sm text-muted-foreground">{t('admin.audit.none')}</p>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="p-2">
                  {t('admin.audit.columns.when')}
                </th>
                <th scope="col" className="p-2">
                  {t('admin.audit.columns.who')}
                </th>
                <th scope="col" className="p-2">
                  {t('admin.audit.columns.action')}
                </th>
                <th scope="col" className="p-2">
                  {t('admin.audit.columns.target')}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">{formatDhaka(e.at)}</td>
                  <td className="p-2">{e.actor_name}</td>
                  <td className="p-2 font-mono text-xs">{e.action}</td>
                  <td className="p-2 text-xs">
                    {e.target.type}
                    {e.target.id ? ` ${e.target.id}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <Button type="button" variant="secondary" disabled={loadingMore} onClick={loadMore}>
          {t('admin.audit.more')}
        </Button>
      )}
    </section>
  );
}
