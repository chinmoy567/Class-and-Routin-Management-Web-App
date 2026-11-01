import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { resetRequestBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { requestPasswordReset } from '@/features/auth/api.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

export function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(resetRequestBody) });
  const request = useMutation({ mutationFn: requestPasswordReset });

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('auth.forgot.title')}</h1>
      {request.isSuccess ? (
        <p role="status">{t('auth.forgot.sent')}</p>
      ) : (
        <>
          <p>{t('auth.forgot.body')}</p>
          <form
            onSubmit={handleSubmit((values) => request.mutate(values.email))}
            noValidate
            className="space-y-4"
          >
            <TextField
              id="email"
              name="email"
              type="email"
              register={register}
              error={errors.email}
              label={t('auth.forgot.email')}
              autoComplete="email"
            />
            <FormError error={request.error} />
            <Button type="submit" className="w-full" disabled={request.isPending}>
              {t('auth.forgot.submit')}
            </Button>
          </form>
        </>
      )}
      <Link to="/login" className="font-medium underline">
        {t('auth.forgot.back')}
      </Link>
    </section>
  );
}
