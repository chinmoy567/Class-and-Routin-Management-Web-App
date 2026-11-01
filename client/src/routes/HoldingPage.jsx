import { Button } from '@/components/ui/button.jsx';
import { useSignOut } from '@/features/auth/hooks.js';
import { t } from '@/lib/i18n';

/**
 * The screens `join-form`, `waiting-approval` and `semester-update` belong to later specs
 * (10, 06, 14). Until they exist, a person held here sees a short message and can sign out.
 */
export function HoldingPage({ screen }) {
  const signOut = useSignOut();
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t(`auth.holding.${screen}Title`)}</h1>
      <p>{t(`auth.holding.${screen}Body`)}</p>
      <Button variant="secondary" className="w-full" onClick={() => signOut.mutate()}>
        {t('common.signOut')}
      </Button>
    </section>
  );
}
