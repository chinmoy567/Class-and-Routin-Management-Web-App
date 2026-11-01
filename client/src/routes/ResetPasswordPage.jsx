import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { resetConfirmBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { confirmPasswordReset } from '@/features/auth/api.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

const passwordOnly = resetConfirmBody.pick({ password: true });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(passwordOnly) });
  const reset = useMutation({ mutationFn: confirmPasswordReset });

  if (!token) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('auth.reset.title')}</h1>
        <p>{t('auth.reset.missing')}</p>
        <Link to="/forgot-password" className="font-medium underline">
          {t('auth.reset.again')}
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('auth.reset.title')}</h1>
      {reset.isSuccess ? (
        <>
          <p role="status">{t('auth.reset.done')}</p>
          <Link to="/login" className="font-medium underline">
            {t('auth.reset.signIn')}
          </Link>
        </>
      ) : (
        <form
          onSubmit={handleSubmit((values) => reset.mutate({ token, password: values.password }))}
          noValidate
          className="space-y-4"
        >
          <TextField
            id="password"
            name="password"
            type="password"
            register={register}
            error={errors.password}
            label={t('auth.reset.password')}
            hint={t('auth.signup.passwordHint')}
            autoComplete="new-password"
          />
          <FormError error={reset.error} />
          <Button type="submit" className="w-full" disabled={reset.isPending}>
            {t('auth.reset.submit')}
          </Button>
          {reset.isError && (
            <Link to="/forgot-password" className="block font-medium underline">
              {t('auth.reset.again')}
            </Link>
          )}
        </form>
      )}
    </section>
  );
}
