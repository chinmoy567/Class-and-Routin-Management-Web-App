import { cn } from '@/lib/utils';

const initialsOf = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');

/** The photo when there is one, otherwise the person's initials (PRF-04). */
export function Avatar({ name, url, className }) {
  const box = cn(
    'inline-flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xl font-semibold',
    className,
  );
  if (url) return <img src={url} alt={name} className={cn(box, 'object-cover')} />;
  return (
    <span role="img" aria-label={name} className={box}>
      <span aria-hidden="true">{initialsOf(name)}</span>
    </span>
  );
}
