import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { changePasswordBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { changePassword } from '@/features/auth/api.js';
import { useSignOut } from '@/features/auth/hooks.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError, applyFieldErrors } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

/** AUTH-27: change the password by giving the current one. Lives in the account area. */
export function ChangePasswordPage() {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(changePasswordBody) });
  const signOut = useSignOut();
  const change = useMutation({
    mutationFn: changePassword,
    onSuccess: () => reset(),
    onError: (err) => applyFieldErrors(err, setError),
  });

  return (
    <section className="max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">{t('auth.changePassword.title')}</h1>
      <h2 className="text-lg font-medium">{t('auth.changePassword.heading')}</h2>
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
        {change.isSuccess && <p role="status">{t('auth.changePassword.done')}</p>}
        <Button type="submit" className="w-full" disabled={change.isPending}>
          {t('auth.changePassword.submit')}
        </Button>
      </form>
      <Button variant="secondary" className="w-full" onClick={() => signOut.mutate()}>
        {t('common.signOut')}
      </Button>
    </section>
  );
}
