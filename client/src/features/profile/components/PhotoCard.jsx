import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';
import { useDeletePhoto, useUploadPhoto } from '../hooks.js';
import { Avatar } from './Avatar.jsx';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;

/** PRF-04: pick a photo, see its scan status, remove it. The server re-checks everything. */
export function PhotoCard({ profile }) {
  const inputId = useId();
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const [localError, setLocalError] = useState(null);
  const { status, url } = profile.photo;

  function onPick(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ALLOWED.includes(file.type)) return setLocalError('profile.photo.badType');
    if (file.size > MAX_BYTES) return setLocalError('profile.photo.tooLarge');
    setLocalError(null);
    upload.mutate(file);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Avatar name={profile.full_name} url={url} />
        <div className="space-y-2">
          <label
            htmlFor={inputId}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-secondary px-4 text-sm font-medium focus-within:ring-2"
          >
            {url ? t('profile.photo.change') : t('profile.photo.add')}
          </label>
          <input
            id={inputId}
            type="file"
            accept={ALLOWED.join(',')}
            onChange={onPick}
            className="sr-only"
          />
          {(url || status === 'pending') && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {t('profile.photo.remove')}
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t('profile.photo.hint')}</p>
      <div aria-live="polite">
        {status === 'pending' && <p role="status">{t('profile.photo.pending')}</p>}
        {status === 'rejected' && (
          <p role="alert" className="text-sm text-destructive">
            {t('profile.photo.rejected')}
          </p>
        )}
        {localError && (
          <p role="alert" className="text-sm text-destructive">
            {t(localError)}
          </p>
        )}
      </div>
      <FormError error={upload.error ?? remove.error} />
    </div>
  );
}
