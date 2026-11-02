import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useSignOut } from '@/features/auth/hooks.js';
import { useMyRequest, useWithdraw } from '@/features/join/hooks.js';
import { t } from '@/lib/i18n';

/** JR-21: status, the section's CR/DCR card, and withdraw. */
export function WaitingPage() {
  const mine = useMyRequest();
  const withdraw = useWithdraw();
  const signOut = useSignOut();
  const request = mine.data;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('join.waiting.title')}</h1>
      {mine.isPending && <p>{t('common.loading')}</p>}
      {request && (
        <p>
          {t(request.escalated ? 'join.waiting.escalated' : 'join.waiting.body', {
            section: request.section.name,
          })}
        </p>
      )}
      {request?.representatives?.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">{t('join.waiting.contacts')}</h2>
          <ul className="space-y-2">
            {request.representatives.map((r) => (
              <li key={r.user_id} className="flex items-center gap-3 rounded-md border p-3">
                {r.photo_url ? (
                  <img src={r.photo_url} alt="" className="size-10 rounded-full object-cover" />
                ) : (
                  <span aria-hidden="true" className="size-10 rounded-full bg-muted" />
                )}
                <span>
                  {r.full_name}{' '}
                  <span className="text-sm text-muted-foreground">({r.role.toUpperCase()})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <FormError error={withdraw.error} />
      {request && (
        <Button
          variant="secondary"
          className="w-full"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate(request.id)}
        >
          {t('join.waiting.withdraw')}
        </Button>
      )}
      <Button variant="secondary" className="w-full" onClick={() => signOut.mutate()}>
        {t('common.signOut')}
      </Button>
    </section>
  );
}
