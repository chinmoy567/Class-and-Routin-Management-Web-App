import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell.jsx';
import { AuthGate } from '@/components/AuthGate.jsx';
import { AuthLayout } from '@/components/AuthLayout.jsx';
import { HomePage } from '@/routes/HomePage.jsx';
import { NotFoundPage } from '@/routes/NotFoundPage.jsx';
import { SignUpPage } from '@/routes/SignUpPage.jsx';
import { CheckEmailPage } from '@/routes/CheckEmailPage.jsx';
import { VerifyPage } from '@/routes/VerifyPage.jsx';
import { VerifyEmailPage } from '@/routes/VerifyEmailPage.jsx';
import { SignInPage } from '@/routes/SignInPage.jsx';
import { SecondStepPage } from '@/routes/SecondStepPage.jsx';
import { TotpSetupPage } from '@/routes/TotpSetupPage.jsx';
import { ForgotPasswordPage } from '@/routes/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from '@/routes/ResetPasswordPage.jsx';
import { ChangePasswordPage } from '@/routes/ChangePasswordPage.jsx';
import { HoldingPage } from '@/routes/HoldingPage.jsx';
import { ProfilePage } from '@/routes/ProfilePage.jsx';
import { PublicProfilePage } from '@/routes/PublicProfilePage.jsx';
import { RequireAdmin } from '@/components/RequireAdmin.jsx';
import { RequireSuperAdmin } from '@/components/RequireSuperAdmin.jsx';
import { DepartmentsPage } from '@/routes/admin/DepartmentsPage.jsx';
import { AdminsPage } from '@/routes/admin/AdminsPage.jsx';
import { SemestersPage } from '@/routes/admin/SemestersPage.jsx';
import { ClassroomsPage } from '@/routes/admin/ClassroomsPage.jsx';
import { ConfirmEmailPage } from '@/routes/ConfirmEmailPage.jsx';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        {/* open to anyone */}
        <Route path="/login" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/check-email" element={<CheckEmailPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/confirm-email" element={<ConfirmEmailPage />} />

        {/* signed in, held on one screen until the account state moves on (AUTH-29) */}
        <Route element={<AuthGate mode="step" />}>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/second-step" element={<SecondStepPage />} />
          <Route path="/setup-totp" element={<TotpSetupPage />} />
          <Route path="/join" element={<HoldingPage screen="join" />} />
          <Route path="/waiting-approval" element={<HoldingPage screen="waiting" />} />
          <Route path="/semester-update" element={<HoldingPage screen="update" />} />
        </Route>
      </Route>

      {/* the signed-in app */}
      <Route element={<AuthGate mode="app" />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/users/:id" element={<PublicProfilePage />} />
          <Route path="/account/password" element={<ChangePasswordPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/classrooms" element={<ClassroomsPage />} />
          </Route>
          <Route element={<RequireSuperAdmin />}>
            <Route path="/admin/departments" element={<DepartmentsPage />} />
            <Route path="/admin/admins" element={<AdminsPage />} />
            <Route path="/admin/semesters" element={<SemestersPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
