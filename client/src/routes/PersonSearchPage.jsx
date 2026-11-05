import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { Avatar } from '@/features/profile/components/Avatar.jsx';
import { useOpenDirect, usePeopleSearch } from '@/features/chat/hooks.js';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** CHT-03: search by name, at least 2 characters. Only people the caller may message appear. */
export function PersonSearchPage() {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const search = usePeopleSearch(q);
  const open = useOpenDirect();
  const tooShort = q.trim().length === 1;

  const start = async (userId) => {
    const conversation = await open.mutateAsync(userId);
    navigate(`/chat/${conversation.id}`);
  };

  return (
    <section className="max-w-xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('chat.search.title')}</h1>
        <Link to="/chat" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          {t('chat.back')}
        </Link>
      </div>

      <div className="space-y-1">
        <label htmlFor="person-search" className="text-sm font-medium">
          {t('chat.search.label')}
        </label>
        <Input
          id="person-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          aria-describedby="person-search-hint"
        />
        <p
          id="person-search-hint"
          className={cn('text-xs', tooShort ? 'text-destructive' : 'text-muted-foreground')}
        >
          {tooShort ? t('chat.search.tooShort') : t('chat.search.hint')}
        </p>
      </div>

      <FormError error={search.error} />
      <FormError error={open.error} />

      {search.data?.length ? (
        <ul className="divide-y rounded-md border">
          {search.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 p-3">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={p.full_name} url={p.photo_url} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.full_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[p.department?.code, ...p.role_labels].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={open.isPending}
                aria-label={t('chat.search.messageLabel', { name: p.full_name })}
                onClick={() => start(p.id)}
              >
                {t('chat.search.message')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {q.trim().length >= 2 && search.isSuccess && !search.data.length ? (
        <p className="text-sm text-muted-foreground">{t('chat.search.none')}</p>
      ) : null}
    </section>
  );
}
