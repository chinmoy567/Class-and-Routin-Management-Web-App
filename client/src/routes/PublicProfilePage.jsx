import { useParams } from 'react-router';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { Avatar } from '@/features/profile/components/Avatar.jsx';
import { usePublicProfile } from '@/features/profile/hooks.js';
import { t } from '@/lib/i18n';

/** PRF-07: what anyone else sees: name, photo and role labels. Nothing private. */
export function PublicProfilePage() {
  const { id } = useParams();
  const { data: person, isPending, error } = usePublicProfile(id);
  if (isPending && !error) return <p>{t('common.loading')}</p>;
  if (error) return <FormError error={error} />;

  return (
    <section className="max-w-sm space-y-4">
      <div className="flex items-center gap-4">
        <Avatar name={person.full_name} url={person.photo_url} />
        <h1 className="text-2xl font-semibold">{person.full_name}</h1>
      </div>
      <ul aria-label={t('profile.rolesLabel')} className="flex flex-wrap gap-2">
        {person.roles.map((role) => (
          <li key={role} className="rounded-full bg-secondary px-3 py-1 text-sm">
            {t(`profile.roles.${role}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}
