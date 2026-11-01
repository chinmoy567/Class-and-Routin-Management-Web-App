import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { phoneSchema } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError, applyFieldErrors } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';
import { useUpdatePhone } from '../hooks.js';

// An empty box clears the phone (PRF-03: the phone is optional).
const formSchema = z.object({ phone: z.union([z.literal(''), phoneSchema]) });

export function PhoneForm({ phone }) {
  const update = useUpdatePhone();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(formSchema), defaultValues: { phone: phone ?? '' } });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((values) =>
        update.mutate(values.phone || null, { onError: (err) => applyFieldErrors(err, setError) }),
      )}
    >
      <TextField
        id="phone"
        name="phone"
        type="tel"
        register={register}
        error={errors.phone}
        label={t('profile.phone.label')}
        hint={t('profile.phone.hint')}
        autoComplete="tel"
        inputMode="tel"
      />
      <FormError error={update.error} />
      {update.isSuccess && <p role="status">{t('profile.phone.saved')}</p>}
      <Button type="submit" disabled={update.isPending}>
        {t('profile.phone.save')}
      </Button>
    </form>
  );
}
