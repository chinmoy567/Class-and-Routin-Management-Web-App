import { FormError } from '@/features/auth/components/FormError.jsx';
import { Avatar } from '@/features/profile/components/Avatar.jsx';
import { ChangeEmailForm } from '@/features/profile/components/ChangeEmailForm.jsx';
import { PhoneForm } from '@/features/profile/components/PhoneForm.jsx';
import { PhotoCard } from '@/features/profile/components/PhotoCard.jsx';
import { useProfile } from '@/features/profile/hooks.js';
import { t } from '@/lib/i18n';

const roleLabel = (role) => {
  const key = `profile.roles.${role}`;
  return t(key) === key ? role : t(key);
};

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

const orDash = (value) => value ?? t('profile.notSet');

/** PRF-01: my profile. The only screen that shows my own email and phone. */
export function ProfilePage() {
  const { data: profile, isPending, error } = useProfile();
  if (isPending && !error) return <p>{t('common.loading')}</p>;
  if (error) return <FormError error={error} />;

  return (
    <section className="max-w-xl space-y-8">
      <header className="flex items-center gap-4">
        <Avatar name={profile.full_name} url={profile.photo.url} />
        <div>
          <h1 className="text-2xl font-semibold">{profile.full_name}</h1>
          <p className="text-sm text-muted-foreground">{t(`profile.kind.${profile.kind}`)}</p>
        </div>
      </header>

      <section aria-labelledby="details" className="space-y-3">
        <h2 id="details" className="text-lg font-medium">
          {t('profile.details')}
        </h2>
        <dl className="space-y-3">
          <Row label={t('profile.fullName')}>
            {profile.full_name}
            <span className="block text-sm text-muted-foreground">{t('profile.nameHint')}</span>
          </Row>
          <Row label={t('profile.emailLabel')}>{orDash(profile.email)}</Row>
          <Row label={t('profile.phone.label')}>{orDash(profile.phone)}</Row>
          <Row label={t('profile.rolesLabel')}>
            {profile.roles.length
              ? profile.roles.map((r) => roleLabel(r.role)).join(', ')
              : t('profile.noRoles')}
          </Row>
          {profile.student && (
            <>
              <Row label={t('profile.student.level')}>{orDash(profile.student.level)}</Row>
              <Row label={t('profile.student.term')}>{orDash(profile.student.term)}</Row>
              <Row label={t('profile.student.section')}>{orDash(profile.student.section)}</Row>
              <Row label={t('profile.student.group')}>{orDash(profile.student.group)}</Row>
              <Row label={t('profile.student.confirmed')}>
                {profile.student.confirmed_semester
                  ? t('profile.student.confirmedFor', {
                      semester: profile.student.confirmed_semester,
                    })
                  : t('profile.notSet')}
              </Row>
            </>
          )}
          {profile.teacher && (
            <Row label={t('profile.teacher.shortCode')}>
              {profile.teacher.linked ? profile.teacher.short_code : t('profile.teacher.notLinked')}
            </Row>
          )}
        </dl>
      </section>

      <section aria-labelledby="photo" className="space-y-3">
        <h2 id="photo" className="text-lg font-medium">
          {t('profile.photo.title')}
        </h2>
        <PhotoCard profile={profile} />
      </section>

      <section aria-labelledby="phone-heading" className="space-y-3">
        <h2 id="phone-heading" className="text-lg font-medium">
          {t('profile.phone.title')}
        </h2>
        <PhoneForm phone={profile.phone} />
      </section>

      <section id="email" aria-labelledby="email-heading" className="space-y-3">
        <h2 id="email-heading" className="text-lg font-medium">
          {t('profile.email.title')}
        </h2>
        <ChangeEmailForm currentEmail={profile.email} />
      </section>
    </section>
  );
}
