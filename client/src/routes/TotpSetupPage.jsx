import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { secondStepBody } from '@crm/shared';
import { Button } from '@/components/ui/button.jsx';
import { startTotpSetup } from '@/features/auth/api.js';
import { useConfirmTotp, useSignOut } from '@/features/auth/hooks.js';
import { TextField } from '@/features/auth/components/TextField.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';

/** `setup-totp`: an admin without an authenticator app sets one up (QR code plus manual key). */
export function TotpSetupPage() {
  const [qr, setQr] = useState(null);
  const setup = useMutation({ mutationFn: startTotpSetup });
  const confirm = useConfirmTotp();
  const signOut = useSignOut();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(secondStepBody) });

  const { mutate: start } = setup;
  useEffect(() => {
    start();
  }, [start]);

  const url = setup.data?.otpauth_url;
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 192 }).then((dataUrl) => {
      if (!cancelled) setQr(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('auth.totp.title')}</h1>
      <p>{t('auth.totp.body')}</p>
      <FormError error={setup.error} />
      {qr && (
        <img src={qr} alt={t('auth.totp.qrAlt')} width="192" height="192" className="mx-auto" />
      )}
      {setup.data && (
        <p className="text-sm">
          {t('auth.totp.manualKey')}{' '}
          <span className="select-all break-all font-mono font-semibold">{setup.data.secret}</span>
        </p>
      )}
      <form
        onSubmit={handleSubmit((values) => confirm.mutate(values.code))}
        noValidate
        className="space-y-4"
      >
        <TextField
          id="code"
          name="code"
          register={register}
          error={errors.code}
          label={t('auth.totp.code')}
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <FormError error={confirm.error} />
        <Button type="submit" className="w-full" disabled={confirm.isPending || !setup.data}>
          {t('auth.totp.confirm')}
        </Button>
      </form>
      <Button variant="ghost" className="w-full" onClick={() => signOut.mutate()}>
        {t('auth.secondStep.startOver')}
      </Button>
    </section>
  );
}
