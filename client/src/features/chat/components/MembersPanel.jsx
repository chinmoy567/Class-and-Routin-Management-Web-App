import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';
import { useRemoveMember } from '../hooks.js';

/**
 * CHT-10b: the member list. Owners and the department admin get roles and removed flags and can
 * remove a member. Ordinary members see names only.
 */
export function MembersPanel({ conversationId, members, isOwner }) {
  const remove = useRemoveMember();
  return (
    <section aria-labelledby="chat-members-title" className="space-y-2">
      <h2 id="chat-members-title" className="text-base font-semibold">
        {t('chat.members.title')}
      </h2>
      <ul className="space-y-2">
        {members.map((m) => {
          const privileged = 'removed' in m;
          return (
            <li
              key={m.user_id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {m.full_name}
                {privileged && m.role_label !== 'student' ? (
                  <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs">
                    {m.role_label}
                  </span>
                ) : null}
                {privileged && m.removed ? (
                  <span className="ml-2 text-xs text-destructive">{t('chat.members.removed')}</span>
                ) : null}
              </span>
              {isOwner && privileged && !m.removed && m.role_label === 'student' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={remove.isPending}
                  aria-label={t('chat.members.removeLabel', { name: m.full_name })}
                  onClick={() => remove.mutate({ conversationId, userId: m.user_id })}
                >
                  {t('chat.members.remove')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <FormError error={remove.error} />
    </section>
  );
}
