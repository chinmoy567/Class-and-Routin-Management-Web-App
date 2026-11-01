import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentSemester } from '@/features/admin/hooks.js';
import { onEvent } from '@/lib/socket';
import { qk } from '@/lib/query-keys';
import { t } from '@/lib/i18n';

/** The current semester's name in the app header. It refetches when `calendar.changed` arrives. */
export function CurrentSemester({ className }) {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useCurrentSemester();

  useEffect(
    () =>
      onEvent('calendar.changed', () =>
        queryClient.invalidateQueries({ queryKey: qk.currentSemester() }),
      ),
    [queryClient],
  );

  if (isPending || error) return null;
  return (
    <p className={className} aria-label={t('semester.label')}>
      {data ? t('semester.current', { name: data.name }) : t('semester.none')}
    </p>
  );
}
