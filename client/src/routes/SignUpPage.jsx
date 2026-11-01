import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { signupBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { signUp } from '@/features/auth/api.js';
import { useDepartments } from '@/features/auth/hooks.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError, applyFieldErrors } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

export function SignUpPage() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm({ resolver: zodResolver(signupBody), defaultValues: { kind: 'student' } });
  const kind = useWatch({ control, name: 'kind' });
  const departments = useDepartments(kind === 'teacher');

  const mutation = useMutation({
    mutationFn: signUp,
    onSuccess: () => navigate('/check-email'),
    onError: (err) => applyFieldErrors(err, setError),
  });

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('auth.signup.title')}</h1>
      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        noValidate
        className="space-y-4"
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('auth.signup.kindLabel')}</legend>
          <div className="flex gap-3">
            {['student', 'teacher'].map((value) => (
              <label
                key={value}
                className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 has-[:checked]:border-primary has-[:checked]:font-semibold"
              >
                <input type="radio" value={value} {...register('kind')} />
                <span>{t(`auth.signup.${value}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <TextField
          id="full_name"
          name="full_name"
          register={register}
          error={errors.full_name}
          label={t('auth.signup.fullName')}
          autoComplete="name"
        />
        <TextField
          id="email"
          name="email"
          type="email"
          register={register}
          error={errors.email}
          label={t('auth.signup.email')}
          hint={t('auth.signup.emailHint')}
          autoComplete="email"
        />

        {kind === 'teacher' && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="department_id" className="block text-sm font-medium">
                {t('auth.signup.department')}
              </label>
              <select
                id="department_id"
                aria-invalid={errors.department_id ? 'true' : undefined}
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
                {...register('department_id')}
              >
                <option value="">{t('auth.signup.departmentPlaceholder')}</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {departments.isError && (
                <p className="text-sm text-muted-foreground">
                  {t('auth.signup.departmentsUnavailable')}
                </p>
              )}
              {errors.department_id && (
                <p className="text-sm text-destructive">{t('auth.fields.department_id.error')}</p>
              )}
            </div>
            <TextField
              id="short_code"
              name="short_code"
              register={register}
              error={errors.short_code}
              label={t('auth.signup.shortCode')}
              hint={t('auth.signup.shortCodeHint')}
              autoCapitalize="characters"
            />
          </>
        )}

        <TextField
          id="password"
          name="password"
          type="password"
          register={register}
          error={errors.password}
          label={t('auth.signup.password')}
          hint={t('auth.signup.passwordHint')}
          autoComplete="new-password"
        />

        <FormError error={mutation.error} />
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {t('auth.signup.submit')}
        </Button>
      </form>
      <p className="text-sm">
        {t('auth.signup.haveAccount')}{' '}
        <Link to="/login" className="font-medium underline">
          {t('auth.signup.signIn')}
        </Link>
      </p>
    </section>
  );
}
