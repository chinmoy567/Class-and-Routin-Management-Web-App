import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { uvIdSchema } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError, applyFieldErrors } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';
import { useUpdateUvId } from '../hooks.js';

// PRF-10 (spec 24): optional, never checked. An empty box clears it.
const formSchema = z.object({ uv_id: uvIdSchema });

export function UvIdForm({ uvId }) {
  const update = useUpdateUvId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(formSchema), defaultValues: { uv_id: uvId ?? '' } });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((values) =>
        update.mutate(values.uv_id ?? null, { onError: (err) => applyFieldErrors(err, setError) }),
      )}
    >
      <TextField
        id="uv_id"
        name="uv_id"
        register={register}
        error={errors.uv_id}
        label={t('profile.uvId.label')}
        hint={t('profile.uvId.hint')}
        inputMode="numeric"
        autoComplete="off"
      />
      <FormError error={update.error} />
      {update.isSuccess && <p role="status">{t('profile.uvId.saved')}</p>}
      <Button type="submit" disabled={update.isPending}>
        {t('profile.uvId.save')}
      </Button>
    </form>
  );
}
