import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { resendBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { resendVerification } from '@/features/auth/api.js';
import { useSignOut } from '@/features/auth/hooks.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

/**
 * `verify-email`: signed in, but the email is not confirmed yet. The server never sends the
 * address back (privacy), so the person types it to ask for a new link.
 */
export function VerifyEmailPage() {
  const signOut = useSignOut();
  const resend = useMutation({ mutationFn: resendVerification });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(resendBody) });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('auth.verifyEmail.title')}</h1>
      <p>{t('auth.verifyEmail.body')}</p>
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
        {resend.isSuccess && <p role="status">{t('auth.verifyEmail.resent')}</p>}
        <Button type="submit" className="w-full" disabled={resend.isPending}>
          {t('auth.verifyEmail.resend')}
        </Button>
      </form>
      <Button variant="secondary" className="w-full" onClick={() => signOut.mutate()}>
        {t('common.signOut')}
      </Button>
    </section>
  );
}
