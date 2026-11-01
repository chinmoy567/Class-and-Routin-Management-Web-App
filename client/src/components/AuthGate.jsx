import { Navigate, Outlet, useLocation } from 'react-router';
import { pathForNext } from '@/features/auth/api.js';
import { useMe } from '@/features/auth/hooks.js';
import { t } from '@/lib/i18n';

/**
 * The route guard (AUTH-29). The server decides where each person belongs (`me.next`); this only
 * follows it. `mode="app"` guards the signed-in app, `mode="step"` guards the single screen a
 * person is held on until their account state moves on. The server still checks everything.
 */
export function AuthGate({ mode }) {
  const location = useLocation();
  const { data: me, isPending, isError } = useMe();

  if (isPending) return <p className="p-4">{t('common.loading')}</p>;
  if (isError || !me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const expected = pathForNext(me.next);
  const inApp = me.next === 'dashboard';
  if (mode === 'app' && !inApp) return <Navigate to={expected} replace />;
  if (mode === 'step' && location.pathname !== expected) return <Navigate to={expected} replace />;
  return <Outlet context={me} />;
}
