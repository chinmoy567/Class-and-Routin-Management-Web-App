// Spec 18, ADM-15: a student who signed in with a temporary password chooses their own password here. The
// server holds them on this step until the flag is cleared, so this is the only screen they can use.
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { changePasswordBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { changePassword } from '@/features/auth/api.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError, applyFieldErrors } from '@/features/auth/components/FormError.jsx';
import { qk } from '@/lib/query-keys';
import { t } from '@/lib/i18n';

export function ForcedPasswordChangePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(changePasswordBody) });
  const change = useMutation({
    mutationFn: changePassword,
    onSuccess: async () => {
      // The server now says where to go next (usually the dashboard); AuthGate follows it from there.
      await queryClient.invalidateQueries({ queryKey: qk.me() });
      navigate('/', { replace: true });
    },
    onError: (err) => applyFieldErrors(err, setError),
  });

  return (
    <section className="max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">{t('auth.forceChange.title')}</h1>
      <p className="text-sm">{t('auth.forceChange.intro')}</p>
      <form
        onSubmit={handleSubmit((values) => change.mutate(values))}
        noValidate
        className="space-y-4"
      >
        <TextField
          id="current_password"
          name="current_password"
          type="password"
          register={register}
          error={errors.current_password}
          label={t('auth.changePassword.current')}
          autoComplete="current-password"
        />
        <TextField
          id="new_password"
          name="new_password"
          type="password"
          register={register}
          error={errors.new_password}
          label={t('auth.changePassword.next')}
          hint={t('auth.signup.passwordHint')}
          autoComplete="new-password"
        />
        <FormError error={change.error} />
        <Button type="submit" className="w-full" disabled={change.isPending}>
          {t('auth.forceChange.submit')}
        </Button>
      </form>
    </section>
  );
}
