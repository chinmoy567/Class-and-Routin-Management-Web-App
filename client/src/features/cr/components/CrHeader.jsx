import { t } from '@/lib/i18n';

const roleLabel = (role) => {
  if (role === 'cr') return t('cr.roleCr');
  if (role === 'dcr') return t('cr.roleDcr');
  return t('cr.roleAdmin');
};

/** CRD-DSH-02: the section and semester this dashboard is for, and the counts. */
export function CrHeader({ overview }) {
  const { section, semester, my_role: myRole, counts } = overview;
  const items = [
    [t('cr.counts.pending'), counts.pending_requests],
    [t('cr.counts.roster'), counts.roster],
    [t('cr.counts.unconfirmed'), counts.unconfirmed],
    [t('cr.counts.flags'), counts.open_flags],
  ];
  return (
    <header className="space-y-3">
      <h1 className="text-xl font-semibold">{section.name}</h1>
      <p className="text-sm text-muted-foreground">
        {t('cr.sectionLine')
          .replace('{semester}', semester.name)
          .replace('{role}', roleLabel(myRole))}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md border p-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
