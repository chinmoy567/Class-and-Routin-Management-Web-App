import { Outlet } from 'react-router';
import { useIsAdmin } from '@/features/auth/hooks.js';
import { NotFoundPage } from '@/routes/NotFoundPage.jsx';

/** Hides the screens a department admin shares with a super admin. The server still refuses them. */
export function RequireAdmin() {
  return useIsAdmin() ? <Outlet /> : <NotFoundPage />;
}
