import { Outlet } from 'react-router';
import { useMe } from '@/features/auth/hooks.js';
import { NotFoundPage } from '@/routes/NotFoundPage.jsx';

/** Hides the admin screens from everyone else. The server still refuses them (CLAUDE.md). */
export function RequireSuperAdmin() {
  const { data } = useMe();
  const isSuper = (data?.roles ?? []).some((r) => r.role === 'super_admin');
  return isSuper ? <Outlet /> : <NotFoundPage />;
}
