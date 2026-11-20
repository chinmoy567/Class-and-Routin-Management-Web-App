import { NavLink, Outlet } from 'react-router';
import { isReleased } from '@crm/shared';
import {
  Flag,
  MessageSquare,
  Gauge,
  Scale,
  ShieldAlert,
  ScrollText,
  UserSearch,
  Building2,
  CalendarCog,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  DoorOpen,
  FileUp,
  GraduationCap,
  UserCheck,
  Home,
  ShieldCheck,
  User,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { CurrentSemester } from '@/components/CurrentSemester.jsx';
import { useIsAdmin, useIsSuperAdmin } from '@/features/auth/hooks.js';
import { EmailActionBanner } from '@/features/profile/components/EmailActionBanner.jsx';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Feature specs add their entries here. Each one needs a translation key and an icon.
const NAV_ITEMS = [
  { to: '/', labelKey: 'nav.home', icon: Home, end: true },
  { to: '/routine', labelKey: 'nav.routine', icon: CalendarDays },
  { to: '/rooms/free', labelKey: 'nav.freeRooms', icon: DoorOpen },
  { to: '/chat', labelKey: 'nav.chat', icon: MessageSquare, feature: 'chat.app' },
  { to: '/profile', labelKey: 'nav.profile', icon: UserRound },
  { to: '/account/password', labelKey: 'nav.account', icon: User },
];

const ADMIN_ITEMS = [
  { to: '/admin', labelKey: 'nav.adminHome', icon: Gauge, end: true },
  { to: '/admin/students', labelKey: 'nav.adminStudents', icon: UserSearch },
  { to: '/admin/flags', labelKey: 'nav.adminFlags', icon: Flag },
  { to: '/admin/reports', labelKey: 'nav.adminReports', icon: ShieldAlert },
  { to: '/admin/appeals', labelKey: 'nav.adminAppeals', icon: Scale },
  { to: '/admin/audit', labelKey: 'nav.adminAudit', icon: ScrollText },
  { to: '/admin/classrooms', labelKey: 'nav.adminClassrooms', icon: DoorOpen },
  { to: '/admin/teacher-registrations', labelKey: 'nav.adminRegistrations', icon: UserCheck },
  { to: '/admin/teachers', labelKey: 'nav.adminTeachers', icon: GraduationCap },
  { to: '/admin/routine-import', labelKey: 'nav.adminRoutineImport', icon: FileUp },
  { to: '/admin/routine-edit', labelKey: 'nav.adminRoutineEdit', icon: CalendarCog },
  { to: '/admin/calendar', labelKey: 'nav.adminCalendar', icon: CalendarDays },
  { to: '/admin/representatives', labelKey: 'nav.adminRepresentatives', icon: UsersRound },
  { to: '/admin/rollover', labelKey: 'nav.adminRollover', icon: ClipboardCheck },
];

const SUPER_ADMIN_ITEMS = [
  { to: '/admin/departments', labelKey: 'nav.adminDepartments', icon: Building2 },
  { to: '/admin/semesters', labelKey: 'nav.adminSemesters', icon: CalendarRange },
  { to: '/admin/admins', labelKey: 'nav.adminAdmins', icon: ShieldCheck },
];

function NavItem({ to, labelKey, icon: Icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group flex min-h-11 min-w-[4.75rem] shrink-0 flex-col items-center justify-center gap-1 px-2 py-2 text-xs transition-colors md:min-h-10 md:min-w-0 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-sm',
          isActive
            ? 'font-medium text-foreground md:bg-accent'
            : 'text-muted-foreground hover:text-foreground md:hover:bg-accent/60',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            aria-hidden="true"
            className={cn('size-5 shrink-0 stroke-[1.5]', isActive && 'text-primary')}
          />
          <span>{t(labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}

/** Mobile first: a scrolling bottom tab bar on phones, a side rail from `md` up. */
export function AppShell({ children }) {
  const isSuper = useIsSuperAdmin();
  const isAdmin = useIsAdmin();
  const visible = (list) => list.filter((item) => !item.feature || isReleased(item.feature));
  const groups = [
    { key: 'main', label: null, items: visible(NAV_ITEMS) },
    ...(isAdmin ? [{ key: 'admin', label: 'nav.sectionAdmin', items: visible(ADMIN_ITEMS) }] : []),
    ...(isSuper
      ? [{ key: 'super', label: 'nav.sectionSuper', items: visible(SUPER_ADMIN_ITEMS) }]
      : []),
  ];
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t('nav.skipToContent')}
      </a>

      <header className="border-b bg-background px-4 py-3 md:hidden">
        <p className="font-serif text-xl">{t('app.name')}</p>
        <CurrentSemester className="text-sm text-muted-foreground" />
      </header>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t bg-background md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-r md:border-t-0 md:px-4 md:py-6"
      >
        <p className="hidden px-3 font-serif text-2xl md:block">{t('app.name')}</p>
        <CurrentSemester className="hidden px-3 pb-6 pt-1 text-sm text-muted-foreground md:block" />
        {groups.map((group) => (
          <div key={group.key} className="flex md:flex-col md:gap-0.5">
            {group.label && (
              <p className="hidden px-3 pb-2 pt-6 text-sm text-muted-foreground md:block">
                {t(group.label)}
              </p>
            )}
            {group.items.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        <EmailActionBanner />
        <main id="main" className="mx-auto max-w-6xl p-4 pb-24 md:p-10 md:pb-10">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
