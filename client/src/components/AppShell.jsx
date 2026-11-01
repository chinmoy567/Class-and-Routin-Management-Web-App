import { NavLink, Outlet } from 'react-router';
import { Building2, CalendarRange, Home, ShieldCheck, User, UserRound } from 'lucide-react';
import { CurrentSemester } from '@/components/CurrentSemester.jsx';
import { useIsSuperAdmin } from '@/features/auth/hooks.js';
import { EmailActionBanner } from '@/features/profile/components/EmailActionBanner.jsx';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Feature specs add their entries here. Each one needs a translation key and an icon.
const NAV_ITEMS = [
  { to: '/', labelKey: 'nav.home', icon: Home, end: true },
  { to: '/profile', labelKey: 'nav.profile', icon: UserRound },
  { to: '/account/password', labelKey: 'nav.account', icon: User },
];

const SUPER_ADMIN_ITEMS = [
  { to: '/admin/departments', labelKey: 'nav.adminDepartments', icon: Building2 },
  { to: '/admin/semesters', labelKey: 'nav.adminSemesters', icon: CalendarRange },
  { to: '/admin/admins', labelKey: 'nav.adminAdmins', icon: ShieldCheck },
];

/** Mobile first: a bottom tab bar on phones, a side rail from `md` up. */
export function AppShell() {
  const isSuper = useIsSuperAdmin();
  const items = isSuper ? [...NAV_ITEMS, ...SUPER_ADMIN_ITEMS] : NAV_ITEMS;
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t('nav.skipToContent')}
      </a>

      <header className="border-b px-4 py-3 md:hidden">
        <p className="text-base font-semibold">{t('app.name')}</p>
        <CurrentSemester className="text-sm text-muted-foreground" />
      </header>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background md:static md:w-56 md:flex-col md:border-r md:border-t-0 md:p-3"
      >
        <p className="hidden px-3 py-2 text-lg font-semibold md:block">{t('app.name')}</p>
        <CurrentSemester className="hidden px-3 pb-2 text-sm text-muted-foreground md:block" />
        {items.map(({ to, labelKey, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 px-3 py-2 text-xs md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-md md:text-sm',
                isActive ? 'font-semibold text-foreground md:bg-accent' : 'text-muted-foreground',
              )
            }
          >
            <Icon aria-hidden="true" className="size-5" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex-1">
        <EmailActionBanner />
        <main id="main" className="p-4 pb-24 md:p-8 md:pb-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
