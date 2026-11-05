import { Navigate } from 'react-router';
import { pathForNext } from '@/features/auth/api.js';
import { useMe } from '@/features/auth/hooks.js';
import { LandingPage } from '@/features/landing/components/LandingPage.jsx';
import { HomePage } from '@/routes/HomePage.jsx';
import { AppShell } from '@/components/AppShell.jsx';
import { t } from '@/lib/i18n';

/**
 * `/` for everyone. A signed-out visitor sees the public landing dashboard (PRD: Visitor landing
 * dashboard). A signed-in person goes where the server says: their own dashboard inside the app
 * shell, or the step screen their account state needs.
 */
export function RootEntry() {
  const { data: me, isPending, isError } = useMe();
  if (isPending) return <p className="p-4">{t('common.loading')}</p>;
  if (isError || !me) return <LandingPage />;
  if (me.next !== 'dashboard') return <Navigate to={pathForNext(me.next)} replace />;
  return (
    <AppShell>
      <HomePage />
    </AppShell>
  );
}
