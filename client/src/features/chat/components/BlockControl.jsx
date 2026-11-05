import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useBlock, useBlocks, useUnblock } from '@/features/chat/hooks.js';
import { t } from '@/lib/i18n';

/** SAF-01: Block or Unblock a person, from their profile. Shows the current state. */
export function BlockControl({ userId, name }) {
  const blocks = useBlocks();
  const block = useBlock();
  const unblock = useUnblock();
  const blocked = (blocks.data ?? []).some((b) => b.user_id === userId);
  const busy = block.isPending || unblock.isPending;
  const toggle = () => (blocked ? unblock.mutate(userId) : block.mutate(userId));
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy || blocks.isPending}
        onClick={toggle}
        aria-label={
          blocked
            ? t('chat.block.unblockLabel').replace('{name}', name)
            : t('chat.block.blockLabel').replace('{name}', name)
        }
      >
        {blocked ? t('chat.block.unblock') : t('chat.block.action')}
      </Button>
      <FormError error={block.error ?? unblock.error} />
    </div>
  );
}
