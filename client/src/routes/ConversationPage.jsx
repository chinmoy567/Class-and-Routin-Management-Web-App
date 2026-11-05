import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, buttonVariants } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useMe } from '@/features/auth/hooks.js';
import { FileComposer, FileError, fileProblem } from '@/features/chat/components/FileComposer.jsx';
import { MembersPanel } from '@/features/chat/components/MembersPanel.jsx';
import { MessageBubble } from '@/features/chat/components/MessageBubble.jsx';
import { ReportDialog } from '@/features/chat/components/ReportDialog.jsx';
import { SuspensionBanner } from '@/features/chat/components/SuspensionBanner.jsx';
import {
  useAppealRemoval,
  useChatSocket,
  useConversations,
  useDeleteMessage,
  useFileLink,
  useMarkRead,
  useMembers,
  useMessages,
  useSendMessage,
  useUploadChatFile,
} from '@/features/chat/hooks.js';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// CHT-06, CHT-10a: the same limits as the server. With a file attached the text is its caption,
// so it may be empty; the empty check runs in onSend for text only.
const messageSchema = z.object({
  body: z.string().trim().max(4000, t('chat.errors.tooLong')),
});
const appealSchema = z.object({
  text: z.string().trim().min(1, t('chat.errors.empty')).max(500, t('chat.errors.appealTooLong')),
});

/** One conversation: messages, send, delete, read marks, the group's members and appeal. */
export function ConversationPage() {
  const { id } = useParams();
  useChatSocket();
  const me = useMe();
  // SAF-10: while suspended the composer is replaced by a notice.
  const suspendedUntil = me.data?.user?.chat_suspended_until;
  const suspended = Boolean(suspendedUntil) && new Date(suspendedUntil).getTime() > Date.now();
  const list = useConversations();
  const conversation = list.data?.find((c) => c.id === id);
  const messages = useMessages(id);
  const isGroup = conversation?.type === 'section_group';
  const members = useMembers(id, isGroup && !conversation?.removed && !messages.isError);
  const markRead = useMarkRead();
  const send = useSendMessage();
  const del = useDeleteMessage();
  const appeal = useAppealRemoval();
  const upload = useUploadChatFile();
  const link = useFileLink();
  const [reporting, setReporting] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [progress, setProgress] = useState(0);
  const form = useForm({ resolver: zodResolver(messageSchema), defaultValues: { body: '' } });
  const appealForm = useForm({ resolver: zodResolver(appealSchema), defaultValues: { text: '' } });

  // Oldest first on screen: the newest page is the first one fetched.
  const shown = (messages.data?.pages ?? [])
    .slice()
    .reverse()
    .flatMap((p) => p.messages);
  const newestId = shown.at(-1)?.id;
  const { mutate: markAsRead } = markRead;
  useEffect(() => {
    if (id && !messages.isError) markAsRead(id);
  }, [id, newestId, messages.isError, markAsRead]);

  const myId = me.data?.user?.id;
  const myRow = members.data?.find((m) => m.user_id === myId);
  const isOwner = Boolean(myRow && ['CR', 'DCR'].includes(myRow.role_label));
  const closed = Boolean(conversation?.closed);

  const onSend = form.handleSubmit(async ({ body }) => {
    if (pendingFile) {
      setProgress(0);
      await upload.mutateAsync({
        conversationId: id,
        file: pendingFile,
        caption: body,
        onProgress: setProgress,
      });
      setPendingFile(null);
      setProgress(0);
      form.reset({ body: '' });
      return;
    }
    if (!body) {
      form.setError('body', { type: 'min', message: t('chat.errors.empty') });
      return;
    }
    await send.mutateAsync({ conversationId: id, body });
    form.reset({ body: '' });
  });
  // Spec 21: a chosen file is checked early, then the server checks its content on upload.
  const chooseFile = (chosen) => {
    setFileError(null);
    if (!chosen) return setPendingFile(null);
    const problem = fileProblem(chosen);
    if (problem) {
      setPendingFile(null);
      return setFileError(problem);
    }
    setPendingFile(chosen);
  };
  // Spec 21, FIL-08: ask for a 5-minute link, then start the download.
  const download = (fileId) =>
    link.mutate(fileId, { onSuccess: (data) => window.location.assign(data.url) });
  const onAppeal = appealForm.handleSubmit(async ({ text }) => {
    await appeal.mutateAsync({ conversationId: id, text });
    appealForm.reset({ text: '' });
  });

  if (list.isPending || messages.isPending) return <p>{t('common.loading')}</p>;

  // CHT-10a: a removed member can no longer read the group, but can appeal once.
  if (conversation?.removed) {
    return (
      <section className="max-w-xl space-y-4">
        <BackLink />
        <h1 className="text-xl font-semibold">{conversation.name ?? t('chat.title')}</h1>
        <p role="status" className="rounded-md border p-3 text-sm">
          {t('chat.removed.body')}
        </p>
        {appeal.isSuccess ? (
          <p role="status" className="text-sm">
            {t('chat.removed.appealSent')}
          </p>
        ) : (
          <form onSubmit={onAppeal} className="space-y-2" noValidate>
            <label htmlFor="appeal-text" className="text-sm font-medium">
              {t('chat.removed.appealLabel')}
            </label>
            <textarea
              id="appeal-text"
              rows={4}
              maxLength={500}
              className="w-full rounded-md border bg-background p-2 text-sm"
              {...appealForm.register('text')}
            />
            {appealForm.formState.errors.text ? (
              <p role="alert" className="text-sm text-destructive">
                {appealForm.formState.errors.text.message}
              </p>
            ) : null}
            <Button type="submit" disabled={appeal.isPending}>
              {t('chat.removed.appealSubmit')}
            </Button>
            <FormError error={appeal.error} />
          </form>
        )}
      </section>
    );
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <BackLink />
        <h1 className="min-w-0 truncate text-xl font-semibold">
          {conversation?.name ?? t('chat.conversationTitle')}
        </h1>
      </div>

      {closed ? (
        <p role="status" className="rounded-md bg-secondary p-3 text-sm">
          {t('chat.closedBanner')}
        </p>
      ) : null}

      <SuspensionBanner />

      {messages.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={messages.isFetchingNextPage}
          onClick={() => messages.fetchNextPage()}
        >
          {t('chat.loadOlder')}
        </Button>
      ) : null}

      <FormError error={messages.error} />

      <ol aria-live="polite" aria-label={t('chat.messagesLabel')} className="flex flex-col gap-3">
        {shown.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            canDelete={!m.deleted && (m.mine || isOwner)}
            onDelete={(messageId) => del.mutate(messageId)}
            onDownload={download}
            downloading={link.isPending}
            onReport={(msg) => setReporting({ messageId: msg.id, targetUserId: msg.sender_id })}
          />
        ))}
      </ol>
      <FormError error={del.error} />
      <FileError error={link.error} />

      {suspended && !closed ? (
        <p role="status" className="rounded-md bg-secondary p-3 text-sm">
          {t('chat.suspension.sendDisabled')}
        </p>
      ) : null}

      {closed || suspended ? null : (
        <form onSubmit={onSend} className="space-y-2" noValidate>
          <FileComposer
            file={pendingFile}
            onChange={chooseFile}
            error={fileError}
            progress={progress}
            uploading={upload.isPending}
          />
          <label htmlFor="chat-body" className="sr-only">
            {t('chat.composeLabel')}
          </label>
          <textarea
            id="chat-body"
            rows={2}
            maxLength={4000}
            placeholder={t('chat.composePlaceholder')}
            className="w-full rounded-md border bg-background p-2 text-sm"
            {...form.register('body')}
          />
          {form.formState.errors.body ? (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.body.message}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={send.isPending}>
              {t('chat.send')}
            </Button>
          </div>
          <FormError error={send.error} />
          <FileError error={upload.error} />
        </form>
      )}

      {isGroup && members.data ? (
        <MembersPanel conversationId={id} members={members.data} isOwner={isOwner} />
      ) : null}

      {reporting ? (
        <ReportDialog
          targetUserId={reporting.targetUserId}
          targetName=""
          messageId={reporting.messageId}
          onClose={() => setReporting(null)}
        />
      ) : null}
    </section>
  );
}

function BackLink() {
  return (
    <Link to="/chat" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
      {t('chat.back')}
    </Link>
  );
}
