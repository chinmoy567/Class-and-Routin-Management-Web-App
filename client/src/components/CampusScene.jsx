import { cn } from '@/lib/utils';

/**
 * The campus illustration beside the landing and sign-in screens: the college student in front of a
 * teaching block (public/images/campus-student.png). It is decoration, so it has empty alt text.
 */
export function CampusScene({ className }) {
  return (
    <img
      src="/images/campus-student.png"
      alt=""
      width="564"
      height="921"
      decoding="async"
      className={cn('object-cover object-[50%_20%]', className)}
    />
  );
}
