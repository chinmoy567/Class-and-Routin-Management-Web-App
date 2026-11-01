import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changeEmailBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError, applyFieldErrors } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';
import { useRequestEmailChange } from '../hooks.js';

/** PRF-05: the link goes to the new address; the old one stays in use until it is opened. */
export function ChangeEmailForm({ currentEmail }) {
  const request = useRequestEmailChange();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(changeEmailBody) });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((values) =>
        request.mutate(values.new_email, {
          onSuccess: () => reset(),
          onError: (err) => applyFieldErrors(err, setError),
        }),
      )}
    >
      <p className="text-sm">{t('profile.email.current', { email: currentEmail })}</p>
      <TextField
        id="new_email"
        name="new_email"
        type="email"
        register={register}
        error={errors.new_email}
        label={t('profile.email.newLabel')}
        hint={t('profile.email.hint')}
        autoComplete="email"
      />
      <FormError error={request.error} />
      {request.isSuccess && <p role="status">{t('profile.email.sent')}</p>}
      <Button type="submit" disabled={request.isPending}>
        {t('profile.email.submit')}
      </Button>
    </form>
  );
}
