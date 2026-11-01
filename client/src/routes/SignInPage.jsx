import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { loginBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { useSignIn } from '@/features/auth/hooks.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

export function SignInPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(loginBody) });
  const signIn = useSignIn();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('auth.login.title')}</h1>
      <form
        onSubmit={handleSubmit((values) => signIn.mutate(values))}
        noValidate
        className="space-y-4"
      >
        <TextField
          id="email"
          name="email"
          type="email"
          register={register}
          error={errors.email}
          label={t('auth.login.email')}
          autoComplete="username"
        />
        <TextField
          id="password"
          name="password"
          type="password"
          register={register}
          error={errors.password}
          label={t('auth.login.password')}
          autoComplete="current-password"
        />
        <FormError error={signIn.error} />
        {signIn.isPending && <p role="status">{t('auth.login.checking')}</p>}
        <Button type="submit" className="w-full" disabled={signIn.isPending}>
          {t('auth.login.submit')}
        </Button>
      </form>
      <div className="space-y-2 text-sm">
        <p>
          <Link to="/forgot-password" className="font-medium underline">
            {t('auth.login.forgot')}
          </Link>
        </p>
        <p>
          {t('auth.login.noAccount')}{' '}
          <Link to="/signup" className="font-medium underline">
            {t('auth.login.signUp')}
          </Link>
        </p>
      </div>
    </section>
  );
}
