import { Outlet } from 'react-router';
import { useIsSuperAdmin } from '@/features/auth/hooks.js';
import { NotFoundPage } from '@/routes/NotFoundPage.jsx';

/** Hides the admin screens from everyone else. The server still refuses them (CLAUDE.md). */
export function RequireSuperAdmin() {
  const isSuper = useIsSuperAdmin();
  return isSuper ? <Outlet /> : <NotFoundPage />;
}
