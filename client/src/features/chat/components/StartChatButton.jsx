import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useOpenDirect } from '@/features/chat/hooks.js';
import { t } from '@/lib/i18n';

/**
 * CHT-04: "Message" on a public profile, a roster or a CR/DCR card. `name` is given so that the
 * screen-reader label says who the message goes to.
 */
export function StartChatButton({ userId, name }) {
  const navigate = useNavigate();
  const open = useOpenDirect();
  const start = async () => {
    const conversation = await open.mutateAsync(userId);
    navigate(`/chat/${conversation.id}`);
  };
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={open.isPending}
        onClick={start}
        aria-label={name ? t('chat.startChatLabel', { name }) : undefined}
      >
        {t('chat.startChat')}
      </Button>
      <FormError error={open.error} />
    </div>
  );
}
