import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button.jsx';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';
import { hhmm, timeOptions } from '@/features/rooms/dates.js';
import { useSendRoomRequest } from '../hooks.js';

const inputClass = 'h-11 w-full rounded-md border bg-background px-3 text-sm';
const MIN_LENGTH = 30; // BKG-02: 30 minutes at least
const MAX_LENGTH = 180; // and 3 hours at most

/** BKG-02: the form rules. The server checks the same rules again and has the last word. */
function requestSchema() {
  return z
    .object({
      target_section_id: z.string().min(1, { message: t('roomRequests.form.targetRequired') }),
      start: z.coerce.number(),
      end: z.coerce.number(),
      note: z
        .string()
        .trim()
        .min(5, { message: t('roomRequests.form.noteShort') })
        .max(300, { message: t('roomRequests.form.noteLong') }),
    })
    .refine((v) => v.end > v.start, {
      path: ['end'],
      message: t('roomRequests.form.endBeforeStart'),
    })
    .refine((v) => v.end - v.start >= MIN_LENGTH && v.end - v.start <= MAX_LENGTH, {
      path: ['end'],
      message: t('roomRequests.form.lengthRange'),
    });
}

/** The server's message for a refused request: booking wording first, then the general one. */
function refusalText(error) {
  const key = `roomRequests.errors.${error?.code}`;
  if (error instanceof ApiError && t(key) !== key) return t(key);
  return errorMessage(error);
}

/**
 * BKG-01, BKG-02: send a request for one room on one date and time range. `targets` lists the
 * sections the user may request for (the CR's own section, or the sections a teacher teaches).
 */
export function RequestRoomDialog({ room, date, from, to, targets, onClose }) {
  const heading = useRef(null);
  const send = useSendRoomRequest();
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(requestSchema()),
    defaultValues: {
      target_section_id: targets[0]?.id ?? '',
      start: from,
      end: to,
      note: '',
    },
  });
  const { register, handleSubmit, formState } = form;
  const errors = formState.errors;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await send.mutateAsync({
        room_id: room.id,
        date,
        start: values.start,
        end: values.end,
        note: values.note,
        target_section_id: values.target_section_id,
      });
      setDone(t('roomRequests.form.sent'));
    } catch (err) {
      setError(refusalText(err));
    }
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-room-h"
      className="space-y-4 rounded-md border bg-background p-4 shadow-lg"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <h2 id="request-room-h" ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {t('roomRequests.form.title', { room: room.code })}
      </h2>
      <p className="text-sm text-muted-foreground">{t('roomRequests.form.intro', { date })}</p>
      <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-1.5">
          <label htmlFor="rr-target" className="block text-sm font-medium">
            {t('roomRequests.form.target')}
          </label>
          <select
            id="rr-target"
            className={inputClass}
            aria-invalid={errors.target_section_id ? true : undefined}
            {...register('target_section_id')}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
          {errors.target_section_id && (
            <p className="text-sm text-destructive">{errors.target_section_id.message}</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="rr-start" className="block text-sm font-medium">
              {t('roomRequests.form.start')}
            </label>
            <select id="rr-start" className={inputClass} {...register('start')}>
              {timeOptions('start').map((m) => (
                <option key={m} value={m}>
                  {hhmm(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rr-end" className="block text-sm font-medium">
              {t('roomRequests.form.end')}
            </label>
            <select
              id="rr-end"
              className={inputClass}
              aria-invalid={errors.end ? true : undefined}
              aria-describedby={errors.end ? 'rr-end-err' : undefined}
              {...register('end')}
            >
              {timeOptions('end').map((m) => (
                <option key={m} value={m}>
                  {hhmm(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {errors.end && (
          <p id="rr-end-err" className="text-sm text-destructive">
            {errors.end.message}
          </p>
        )}
        <div className="space-y-1.5">
          <label htmlFor="rr-note" className="block text-sm font-medium">
            {t('roomRequests.form.note')}
          </label>
          <textarea
            id="rr-note"
            rows={3}
            maxLength={300}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? 'rr-note-err' : 'rr-note-hint'}
            {...register('note')}
          />
          <p id="rr-note-hint" className="text-xs text-muted-foreground">
            {t('roomRequests.form.noteHint')}
          </p>
          {errors.note && (
            <p id="rr-note-err" className="text-sm text-destructive">
              {errors.note.message}
            </p>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="text-sm">
            {done}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={send.isPending || Boolean(done)} onClick={onSubmit}>
            {t('roomRequests.form.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onClose()}>
            {done ? t('roomRequests.form.close') : t('roomRequests.form.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
