import { Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useBlocks, useMyReports, useUnblock } from '@/features/chat/hooks.js';
import { t } from '@/lib/i18n';
import { formatDhaka } from '@/lib/time';
import { cn } from '@/lib/utils';

/** SAF-01, SAF-04: the blocked people (unblock at any time) and the reports the user has made. */
export function BlockedUsersPage() {
  const blocks = useBlocks();
  const reports = useMyReports();
  const unblock = useUnblock();

  return (
    <section className="max-w-xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-2xl font-semibold">{t('chat.block.title')}</h1>
        <Link to="/chat" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          {t('chat.back')}
        </Link>
      </div>

      {blocks.isPending ? (
        <p>{t('common.loading')}</p>
      ) : blocks.data?.length ? (
        <ul className="divide-y rounded-md border">
          {blocks.data.map((b) => (
            <li key={b.user_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="min-w-0 truncate font-medium">{b.full_name}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={unblock.isPending}
                aria-label={t('chat.block.unblockLabel').replace('{name}', b.full_name)}
                onClick={() => unblock.mutate(b.user_id)}
              >
                {t('chat.block.unblock')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('chat.block.empty')}</p>
      )}
      <FormError error={unblock.error} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t('chat.report.mineTitle')}</h2>
        {reports.data?.length ? (
          <ul className="divide-y rounded-md border">
            {reports.data.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span>
                  {t(`chat.report.categories.${r.category}`)}
                  <span className="text-muted-foreground">
                    {' · '}
                    {formatDhaka(r.created_at, 'd MMM yyyy')}
                  </span>
                </span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {r.status === 'reviewed' ? t('chat.report.reviewed') : t('chat.report.open')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('chat.report.mineNone')}</p>
        )}
      </div>
    </section>
  );
}
