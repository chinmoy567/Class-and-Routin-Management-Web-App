import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { secondStepBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { ApiError } from '@/lib/api';
import { emailSecondStepCode } from '@/features/auth/api.js';
import { useSecondStep, useSignOut } from '@/features/auth/hooks.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

/** `second-step`: an admin enters the authenticator code, or one that was emailed (AUTH-17). */
export function SecondStepPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(secondStepBody) });
  const verify = useSecondStep();
  const emailCode = useMutation({ mutationFn: emailSecondStepCode });
  const signOut = useSignOut();
  // five wrong codes end the session (AUTH-20): send the person back to the password
  const sessionEnded = verify.error instanceof ApiError && verify.error.status === 401;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('auth.secondStep.title')}</h1>
      <p>{t('auth.secondStep.body')}</p>
      <form
        onSubmit={handleSubmit((values) => verify.mutate(values.code))}
        noValidate
        className="space-y-4"
      >
        <TextField
          id="code"
          name="code"
          register={register}
          error={errors.code}
          label={t('auth.secondStep.code')}
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <FormError error={verify.error ?? emailCode.error} />
        {emailCode.isSuccess && <p role="status">{t('auth.secondStep.emailSent')}</p>}
        <Button type="submit" className="w-full" disabled={verify.isPending || sessionEnded}>
          {t('auth.secondStep.submit')}
        </Button>
      </form>
      <Button
        variant="secondary"
        className="w-full"
        disabled={emailCode.isPending}
        onClick={() => emailCode.mutate()}
      >
        {t('auth.secondStep.emailMe')}
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => signOut.mutate()}>
        {t('auth.secondStep.startOver')}
      </Button>
    </section>
  );
}
