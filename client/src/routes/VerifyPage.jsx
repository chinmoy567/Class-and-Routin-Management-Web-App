import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { resendBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { resendVerification, verifyEmail } from '@/features/auth/api.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

/** The landing page for the link in the verification email (AUTH-10). */
export function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const verify = useMutation({ mutationFn: verifyEmail });
  const resend = useMutation({ mutationFn: resendVerification });
  const started = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(resendBody) });

  const { mutate } = verify;
  useEffect(() => {
    if (token && !started.current) {
      started.current = true; // a link works once, so never send it twice
      mutate(token);
    }
  }, [token, mutate]);

  if (!token || verify.isError) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('auth.verify.expiredTitle')}</h1>
        <p>{t('auth.verify.expired')}</p>
        <form
          onSubmit={handleSubmit((values) => resend.mutate(values.email))}
          noValidate
          className="space-y-4"
        >
          <TextField
            id="email"
            name="email"
            type="email"
            register={register}
            error={errors.email}
            label={t('auth.verify.email')}
            autoComplete="email"
          />
          <FormError error={resend.error} />
          {resend.isSuccess && <p role="status">{t('auth.verify.resent')}</p>}
          <Button type="submit" className="w-full" disabled={resend.isPending}>
            {t('auth.verify.resend')}
          </Button>
        </form>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-live="polite">
      <h1 className="text-2xl font-semibold">{t('auth.verify.title')}</h1>
      {verify.isSuccess ? (
        <>
          <p>{t('auth.verify.done')}</p>
          <Link to="/login" className="font-medium underline">
            {t('auth.verify.signIn')}
          </Link>
        </>
      ) : (
        <p>{t('auth.verify.working')}</p>
      )}
    </section>
  );
}
