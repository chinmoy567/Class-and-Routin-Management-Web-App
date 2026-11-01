import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

/** Turns a failed request into one translated sentence, chosen by the error code. */
export function errorMessage(error) {
  if (!error) return null;
  if (!(error instanceof ApiError)) return t('errors.NETWORK');
  if (error.code === 'RATE_LIMITED' && error.retryAfter) {
    return t('auth.login.wait', { seconds: error.retryAfter });
  }
  const key = `errors.${error.code}`;
  return t(key) === key ? t('errors.INTERNAL') : t(key);
}

export function FormError({ error }) {
  const message = errorMessage(error);
  return (
    <div role="alert" aria-live="polite">
      {message && (
        <p className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/** Mark the fields the server rejected, so their translated messages show. */
export function applyFieldErrors(error, setError) {
  if (!(error instanceof ApiError) || !error.fields) return;
  for (const name of Object.keys(error.fields)) setError(name, { type: 'server' });
}
