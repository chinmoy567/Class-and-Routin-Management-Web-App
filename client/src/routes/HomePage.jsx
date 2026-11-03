import { Navigate } from 'react-router';
import { t } from '@/lib/i18n';
import { useMe } from '@/features/auth/hooks.js';
import { DashboardPage } from '@/features/dashboard/components/DashboardPage.jsx';

/** The first page after sign-in. Students and teachers get their dashboard (spec 16). */
export function HomePage() {
  const { data: me } = useMe();
  const kind = me?.user?.kind;
  if (kind === 'student' || kind === 'teacher') return <DashboardPage kind={kind} />;
  // Spec 18: a staff account (an admin with no teaching role) goes straight to the admin home.
  if (kind === 'staff') return <Navigate to="/admin" replace />;

  return (
    <section>
      <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('home.intro')}</p>
    </section>
  );
}
